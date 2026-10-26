import { Job } from 'bullmq';
import type { ReproJobData } from './jobs.js';
import { transitionRun, updateRun, appendLog } from '../db/runs.js';
import { emitStatus, emitLog } from '../sse/stream.js';
import { cloneAndInstall, cleanupHostDir } from '../sandbox/clone.js';
import { destroySandbox } from '../sandbox/runner.js';
import { runAgentLoop } from '../agent/loop.js';
import { runVerificationGate, getFileHash, type GateResult } from '../verification/gate.js';
import { config } from '../config.js';
import { pushBranch, createPR } from '../github/pr.js';

/**
 * Full state-machine job processor.
 * State transitions: queued → cloning → reproducing → patching → verifying → pr_opened | failed
 *
 * Every transition is persisted to the DB before execution continues.
 * On any error, we transition to 'failed' with a reason.
 */
export async function processJob(job: Job<ReproJobData>): Promise<void> {
  const { runId, repoUrl, issueNumber, issueTitle, issueBody } = job.data;

  let hostWorkDir: string | null = null;
  let sandbox: ReturnType<typeof Object.create> | null = null;

  const log = async (msg: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info', source: 'agent' | 'sandbox' | 'system' = 'system') => {
    await appendLog(runId, msg, level, source);
    emitLog({ runId, level, source, message: msg, ts: new Date().toISOString() });
  };

  const transition = async (status: Parameters<typeof transitionRun>[1], detail?: Record<string, unknown>) => {
    await transitionRun(runId, status, detail);
    emitStatus({ runId, status, ts: new Date().toISOString() });
    await log(`State → ${status}`, 'info', 'system');
  };

  const fail = async (reason: string) => {
    await log(`Run failed: ${reason}`, 'error', 'system');
    try {
      await transition('failed', { reason });
      await updateRun(runId, { failure_reason: reason });
    } catch { /* best-effort */ }
    if (sandbox) {
      try { await destroySandbox(sandbox); } catch { /* best-effort */ }
    }
    if (hostWorkDir) cleanupHostDir(hostWorkDir);
  };

  try {
    // ── 1. CLONING ─────────────────────────────────────────────────────────
    await transition('cloning');
    const cloneResult = await cloneAndInstall(repoUrl, runId);
    hostWorkDir = cloneResult.hostWorkDir;
    sandbox = cloneResult.sandbox;

    // ── 2. REPRODUCING ─────────────────────────────────────────────────────
    await transition('reproducing');
    const reproResult = await runAgentLoop({
      runId,
      sandbox,
      repoUrl,
      issueNumber,
      issueTitle,
      issueBody,
      phase: 'reproduce',
      maxAttempts: config.AGENT_MAX_ATTEMPTS,
    });
    await updateRun(runId, { token_usage: reproResult.tokensUsed });

    if (!reproResult.success || !reproResult.reproductionTestPath) {
      await fail(`Reproduction failed: ${reproResult.reason}`);
      return;
    }

    const reproTestPath = reproResult.reproductionTestPath;
    await log(`Reproduction test written: ${reproTestPath}`, 'info', 'system');
    const reproTestHash = await getFileHash(sandbox, reproTestPath);

    // ── 3. PATCHING & 4. VERIFYING (Iterative Feedback Loop) ───────────────
    let attempt = 0;
    let gateResult: GateResult | null = null;
    let lastFailureFeedback = '';

    while (attempt < config.AGENT_MAX_ATTEMPTS) {
      attempt++;
      await updateRun(runId, { attempt });
      await log(`[attempt ${attempt}/${config.AGENT_MAX_ATTEMPTS}] Starting patch synthesis`, 'info', 'system');

      await transition('patching');
      const patchResult = await runAgentLoop({
        runId,
        sandbox,
        repoUrl,
        issueNumber,
        issueTitle,
        issueBody,
        phase: 'patch',
        previousAttempts: lastFailureFeedback || undefined,
        maxAttempts: 1,
      });
      await updateRun(runId, { token_usage: patchResult.tokensUsed });

      if (!patchResult.success) {
        lastFailureFeedback = `Patch attempt #${attempt} failed: ${patchResult.reason}`;
        await log(lastFailureFeedback, 'warn', 'agent');
        continue;
      }

      await transition('verifying');
      gateResult = await runVerificationGate({
        runId,
        sandbox,
        reproductionTestPath: reproTestPath,
        expectedTestHash: reproTestHash ?? undefined,
        timeoutMs: config.SANDBOX_TIMEOUT_MS,
      });

      if (gateResult.passed) {
        await log(`Verification gate passed on attempt ${attempt} ✅`, 'info', 'system');
        break;
      }

      lastFailureFeedback = `Verification gate failed on attempt #${attempt}: ${gateResult.failureReason}`;
      if (gateResult.detail.afterRepro.failed > 0) {
        lastFailureFeedback += `\nRepro test still failing: ${gateResult.detail.afterRepro.output.slice(0, 500)}`;
      }
      if (gateResult.detail.afterFull.failed > 0) {
        lastFailureFeedback += `\nRegression in full suite: ${gateResult.detail.afterFull.output.slice(0, 500)}`;
      }
      await log(`Attempt #${attempt} failed verification: ${gateResult.failureReason}`, 'warn', 'system');
    }

    if (!gateResult || !gateResult.passed) {
      await fail(`All ${config.AGENT_MAX_ATTEMPTS} attempts failed verification: ${gateResult?.failureReason ?? 'Inconclusive run'}`);
      return;
    }

    await log('Verification gate passed ✅', 'info', 'system');

    // ── 5. OPEN PR ─────────────────────────────────────────────────────────
    if (config.GITHUB_TOKEN && !repoUrl.startsWith('demo:') && !repoUrl.startsWith('seeds/')) {
      const branchName = `repro/${runId.slice(0, 8)}-fix-issue-${issueNumber}`;
      await log(`Pushing branch ${branchName}`, 'info', 'system');

      await pushBranch({
        hostWorkDir: hostWorkDir!,
        repoUrl,
        branchName,
        githubToken: config.GITHUB_TOKEN,
      });

      const prUrl = await createPR({
        runId,
        repoUrl,
        issueNumber,
        issueTitle,
        reproductionTestPath: reproTestPath,
        gateResult,
        branchName,
      });

      await transition('pr_opened', { pr_url: prUrl });
      await updateRun(runId, { pr_url: prUrl });
      await log(`PR opened: ${prUrl}`, 'info', 'system');
    } else {
      // No GitHub token — mark as verified (useful for demo mode)
      await transition('pr_opened', { note: 'no GITHUB_TOKEN — PR skipped' });
      await log('No GITHUB_TOKEN set — skipping PR creation (demo mode)', 'warn', 'system');
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await fail(message);
  } finally {
    // Always clean up sandbox and temp dir
    if (sandbox) {
      try { await destroySandbox(sandbox); } catch { /* best-effort */ }
    }
    if (hostWorkDir) cleanupHostDir(hostWorkDir);
  }
}
