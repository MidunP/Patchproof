import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GateResult } from '../src/verification/gate';

// ── We test the gate logic in isolation by mocking runTests ──────────────────
// The actual Docker execution is integration-tested in sandbox.test.ts.

vi.mock('../src/sandbox/tools', () => ({
  runTests: vi.fn(),
}));

vi.mock('../src/db/runs', () => ({
  appendLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/sse/stream', () => ({
  emitLog: vi.fn(),
}));

vi.mock('../src/sandbox/executor', () => ({
  execInSandbox: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false }),
}));

import { runTests } from '../src/sandbox/tools';
import { execInSandbox } from '../src/sandbox/executor';
import { runVerificationGate, formatGateReport } from '../src/verification/gate';

const mockRunTests = vi.mocked(runTests);
const mockExecInSandbox = vi.mocked(execInSandbox);

// Helper: build a TestRunResult
function makeTestResult(passed: number, failed: number, exitCode = failed > 0 ? 1 : 0) {
  return {
    ok: exitCode === 0,
    passed,
    failed,
    total: passed + failed,
    output: `Tests: ${passed} passed, ${failed} failed`,
    exitCode,
  };
}

// Fake sandbox
const fakeSandbox = { id: 'test-container-id', container: {} as any, workDir: '/workspace' };

describe('Verification Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('✅ PASSES when: repro fails before fix, passes after, full suite passes', async () => {
    mockRunTests
      .mockResolvedValueOnce(makeTestResult(1, 0)) // after repro: PASS
      .mockResolvedValueOnce(makeTestResult(0, 1)) // before repro (after stash): FAIL
      .mockResolvedValueOnce(makeTestResult(5, 0)); // full suite: PASS

    const result = await runVerificationGate({
      runId: 'test-run',
      sandbox: fakeSandbox,
      reproductionTestPath: 'tests/bug.test.ts',
    });

    expect(result.passed).toBe(true);
    expect(result.failureReason).toBeUndefined();
  });

  it('❌ FAILS when repro test does NOT fail before fix (test is wrong)', async () => {
    mockRunTests
      .mockResolvedValueOnce(makeTestResult(1, 0)) // after repro: PASS
      .mockResolvedValueOnce(makeTestResult(1, 0)) // before repro: also PASS — bad!
      .mockResolvedValueOnce(makeTestResult(5, 0)); // full suite

    const result = await runVerificationGate({
      runId: 'test-run',
      sandbox: fakeSandbox,
      reproductionTestPath: 'tests/bug.test.ts',
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/did NOT fail before the fix/);
  });

  it('❌ FAILS when repro test still fails after fix (fix is incomplete)', async () => {
    mockRunTests
      .mockResolvedValueOnce(makeTestResult(0, 1)) // after repro: still FAILING
      .mockResolvedValueOnce(makeTestResult(0, 1)) // before repro: FAILING
      .mockResolvedValueOnce(makeTestResult(5, 0)); // full suite

    const result = await runVerificationGate({
      runId: 'test-run',
      sandbox: fakeSandbox,
      reproductionTestPath: 'tests/bug.test.ts',
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/still FAILS after the fix/);
  });

  it('❌ FAILS when full suite has regressions after fix', async () => {
    mockRunTests
      .mockResolvedValueOnce(makeTestResult(1, 0)) // after repro: PASS
      .mockResolvedValueOnce(makeTestResult(0, 1)) // before repro: FAIL (correct)
      .mockResolvedValueOnce(makeTestResult(3, 2)); // full suite: 2 REGRESSIONS

    const result = await runVerificationGate({
      runId: 'test-run',
      sandbox: fakeSandbox,
      reproductionTestPath: 'tests/bug.test.ts',
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/regression/);
  });

  it('❌ FAILS when repro test has 0 passing tests (empty/invalid test)', async () => {
    mockRunTests
      .mockResolvedValueOnce(makeTestResult(0, 0)) // after repro: 0 tests — invalid
      .mockResolvedValueOnce(makeTestResult(0, 1)) // before repro: FAIL
      .mockResolvedValueOnce(makeTestResult(5, 0));

    const result = await runVerificationGate({
      runId: 'test-run',
      sandbox: fakeSandbox,
      reproductionTestPath: 'tests/bug.test.ts',
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/still FAILS after the fix/);
  });

  it('❌ FAILS when reproduction test was tampered with (hash mismatch)', async () => {
    // Return a hash that differs from expected
    mockExecInSandbox.mockResolvedValueOnce({
      stdout: '1111111111111111111111111111111111111111111111111111111111111111  /workspace/tests/bug.test.ts\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const result = await runVerificationGate({
      runId: 'test-run',
      sandbox: fakeSandbox,
      reproductionTestPath: 'tests/bug.test.ts',
      expectedTestHash: '2222222222222222222222222222222222222222222222222222222222222222',
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/test tampering detected/);
  });

  it('❌ FAILS when repro test failed due to syntax/crash rather than assertion failure', async () => {
    mockRunTests
      .mockResolvedValueOnce(makeTestResult(1, 0)) // after repro: PASS
      .mockResolvedValueOnce({
        ok: false,
        passed: 0,
        failed: 0, // 0 failed assertions, but exitCode !== 0 (syntax / crash error)
        total: 0,
        output: 'SyntaxError: Unexpected token',
        exitCode: 1,
      })
      .mockResolvedValueOnce(makeTestResult(5, 0)); // full suite

    const result = await runVerificationGate({
      runId: 'test-run',
      sandbox: fakeSandbox,
      reproductionTestPath: 'tests/bug.test.ts',
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/crash, compilation, or setup error/);
  });
});

describe('formatGateReport', () => {
  it('produces a markdown table with gate status', () => {
    const result: GateResult = {
      passed: true,
      detail: {
        beforeRepro: makeTestResult(0, 1),
        afterRepro: makeTestResult(1, 0),
        afterFull: makeTestResult(5, 0),
      },
    };
    const report = formatGateReport(result);
    expect(report).toContain('## Verification Gate Report');
    expect(report).toContain('PASSED');
    expect(report).toContain('✅');
  });

  it('includes failure reason when gate fails', () => {
    const result: GateResult = {
      passed: false,
      failureReason: 'Regression introduced in existing tests',
      detail: {
        beforeRepro: makeTestResult(0, 1),
        afterRepro: makeTestResult(1, 0),
        afterFull: makeTestResult(3, 2),
      },
    };
    const report = formatGateReport(result);
    expect(report).toContain('FAILED');
    expect(report).toContain('Regression introduced');
  });
});
