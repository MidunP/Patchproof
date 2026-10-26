import { Job } from 'bullmq';
import type { ReproJobData } from './jobs';
import { transitionRun, updateRun, appendLog } from '../db/runs';

/**
 * Main job processor — wires together the state machine.
 * Milestone 1: stub that just transitions through states and logs.
 * Real logic added in M2 (sandbox) and M3 (agent loop).
 */
export async function processJob(job: Job<ReproJobData>): Promise<void> {
  const { runId, repoUrl, issueNumber } = job.data;

  console.log(`[worker] Processing run ${runId} — repo=${repoUrl} issue=#${issueNumber}`);

  try {
    // ── cloning ────────────────────────────────────────────────────────────
    await transitionRun(runId, 'cloning');
    await appendLog(runId, `[M1 stub] Would clone ${repoUrl}`, 'info', 'system');

    // ── reproducing ────────────────────────────────────────────────────────
    await transitionRun(runId, 'reproducing');
    await appendLog(runId, '[M1 stub] Would run agent to reproduce bug', 'info', 'agent');

    // ── patching ──────────────────────────────────────────────────────────
    await transitionRun(runId, 'patching');
    await appendLog(runId, '[M1 stub] Would apply patch', 'info', 'agent');

    // ── verifying ─────────────────────────────────────────────────────────
    await transitionRun(runId, 'verifying');
    await appendLog(runId, '[M1 stub] Would verify before/after', 'info', 'system');

    // ── done (stubbed as failed until M4 gate is real) ────────────────────
    await transitionRun(runId, 'failed', { reason: 'stub — not implemented yet' });
    await updateRun(runId, { failure_reason: 'stub — not implemented yet' });
    await appendLog(runId, '[M1 stub] Run finished (stub failure)', 'warn', 'system');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Run ${runId} threw: ${message}`);

    try {
      await transitionRun(runId, 'failed', { error: message });
      await updateRun(runId, { failure_reason: message });
    } catch {
      // best-effort
    }
  }
}
