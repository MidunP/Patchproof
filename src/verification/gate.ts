import type { SandboxContainer } from '../sandbox/runner.js';
import { runTests, type TestRunResult } from '../sandbox/tools.js';
import { appendLog } from '../db/runs.js';
import { emitLog } from '../sse/stream.js';

export interface GateResult {
  passed: boolean;
  failureReason?: string;
  detail: {
    beforeRepro: TestRunResult;   // repro test ran BEFORE fix → must FAIL
    afterRepro: TestRunResult;    // repro test ran AFTER fix → must PASS
    afterFull: TestRunResult;     // full suite AFTER fix → must all PASS
  };
}

/**
 * The verification gate.
 *
 * Invariant: a PR is only opened when ALL three conditions hold:
 *   1. The reproduction test FAILS before the fix (confirmed bug exists)
 *   2. The reproduction test PASSES after the fix (confirmed fix works)
 *   3. The full test suite PASSES after the fix (no regressions)
 *
 * This function is called after the agent has written the test AND applied the fix.
 * The sandbox already has the fix applied when this is called.
 *
 * "Before" state is captured by temporarily reverting the fix via git.
 */
export async function runVerificationGate(opts: {
  runId: string;
  sandbox: SandboxContainer;
  reproductionTestPath: string;
  timeoutMs?: number;
}): Promise<GateResult> {
  const { runId, sandbox, reproductionTestPath, timeoutMs = 60_000 } = opts;

  await log(runId, '[gate] Starting verification gate');

  // ── Step 1: Run the repro test in CURRENT state (fix applied) ────────────────
  await log(runId, '[gate] Step 1: Running repro test AFTER fix');
  const afterRepro = await runTests(sandbox, reproductionTestPath, timeoutMs);
  await log(
    runId,
    `[gate] After-fix repro: ${afterRepro.passed} passed, ${afterRepro.failed} failed`,
    afterRepro.ok ? 'info' : 'warn',
  );

  // ── Step 2: Revert fix via git to check BEFORE state ─────────────────────────
  await log(runId, '[gate] Step 2: Reverting fix (git stash) to check before state');
  const stashResult = await execGit(sandbox, 'git stash');
  await log(runId, `[gate] git stash: ${stashResult}`);

  const beforeRepro = await runTests(sandbox, reproductionTestPath, timeoutMs);
  await log(
    runId,
    `[gate] Before-fix repro: ${beforeRepro.passed} passed, ${beforeRepro.failed} failed`,
    !beforeRepro.ok ? 'info' : 'warn', // we WANT it to fail here
  );

  // ── Step 3: Re-apply the fix ──────────────────────────────────────────────────
  await log(runId, '[gate] Step 3: Re-applying fix (git stash pop)');
  const popResult = await execGit(sandbox, 'git stash pop');
  await log(runId, `[gate] git stash pop: ${popResult}`);

  // ── Step 4: Run the FULL suite ────────────────────────────────────────────────
  await log(runId, '[gate] Step 4: Running full test suite');
  const afterFull = await runTests(sandbox, undefined, timeoutMs);
  await log(
    runId,
    `[gate] Full suite: ${afterFull.passed} passed, ${afterFull.failed} failed`,
    afterFull.ok ? 'info' : 'warn',
  );

  // ── Evaluate gate conditions ──────────────────────────────────────────────────
  const reproFailedBefore = !beforeRepro.ok || beforeRepro.failed > 0;
  const reproPassedAfter = afterRepro.ok && afterRepro.failed === 0 && afterRepro.passed > 0;
  const fullSuitePassedAfter = afterFull.ok && afterFull.failed === 0;

  if (!reproFailedBefore) {
    return {
      passed: false,
      failureReason:
        'Reproduction test did NOT fail before the fix — the test does not actually reproduce the bug.',
      detail: { beforeRepro, afterRepro, afterFull },
    };
  }

  if (!reproPassedAfter) {
    return {
      passed: false,
      failureReason:
        `Reproduction test still FAILS after the fix (${afterRepro.failed} failing).`,
      detail: { beforeRepro, afterRepro, afterFull },
    };
  }

  if (!fullSuitePassedAfter) {
    return {
      passed: false,
      failureReason:
        `Full test suite has ${afterFull.failed} failure(s) after the fix — regression introduced.`,
      detail: { beforeRepro, afterRepro, afterFull },
    };
  }

  await log(runId, '[gate] ✅ All gate conditions passed', 'info');
  return {
    passed: true,
    detail: { beforeRepro, afterRepro, afterFull },
  };
}

/** Format gate results for the PR body / run report */
export function formatGateReport(result: GateResult): string {
  const { beforeRepro, afterRepro, afterFull } = result.detail;

  return `## Verification Gate Report

| Check | Result |
|---|---|
| Repro test FAILS before fix | ${!beforeRepro.ok ? '✅ Yes (test failed as expected)' : '❌ No (test unexpectedly passed)'} |
| Repro test PASSES after fix | ${afterRepro.ok ? '✅ Yes' : '❌ No'} |
| Full suite passes after fix | ${afterFull.ok ? '✅ Yes' : '❌ No'} |
| **Gate** | **${result.passed ? '✅ PASSED' : '❌ FAILED'}** |

${result.failureReason ? `**Failure reason:** ${result.failureReason}` : ''}

### Before fix (repro test)
\`\`\`
${beforeRepro.output.slice(0, 1000)}
\`\`\`

### After fix (repro test)
\`\`\`
${afterRepro.output.slice(0, 1000)}
\`\`\`

### After fix (full suite)
\`\`\`
${afterFull.output.slice(0, 1000)}
\`\`\`
`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────
import { execInSandbox } from '../sandbox/executor.js';

async function execGit(sandbox: SandboxContainer, cmd: string): Promise<string> {
  const result = await execInSandbox(sandbox, ['sh', '-c', cmd]);
  return (result.stdout + result.stderr).trim();
}

async function log(
  runId: string,
  message: string,
  level: 'info' | 'warn' | 'error' | 'debug' = 'info',
): Promise<void> {
  await appendLog(runId, message, level, 'system');
  emitLog({ runId, level, source: 'system', message, ts: new Date().toISOString() });
}
