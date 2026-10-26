import path from 'path';
import type { SandboxContainer } from './runner.js';
import { execInSandbox } from './executor.js';

// ── Path safety ───────────────────────────────────────────────────────────────
const WORKSPACE_ROOT = '/workspace';

/**
 * Resolve a user-supplied path and throw if it would escape /workspace.
 * This is the single chokepoint for path traversal prevention.
 */
export function safePath(userPath: string): string {
  // Normalize and resolve relative to workspace root
  const resolved = path.posix.resolve(WORKSPACE_ROOT, userPath.replace(/\\/g, '/'));
  if (!resolved.startsWith(WORKSPACE_ROOT + '/') && resolved !== WORKSPACE_ROOT) {
    throw new Error(`Path traversal attempt blocked: ${userPath} → ${resolved}`);
  }
  return resolved;
}

// ── Tool result type ──────────────────────────────────────────────────────────
export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

// ── read_file ─────────────────────────────────────────────────────────────────
export async function readFile(
  sandbox: SandboxContainer,
  filePath: string,
): Promise<ToolResult> {
  try {
    const safe = safePath(filePath);
    const result = await execInSandbox(sandbox, ['cat', safe]);
    if (result.exitCode !== 0) {
      return { ok: false, output: '', error: result.stderr || `Exit ${result.exitCode}` };
    }
    return { ok: true, output: result.stdout };
  } catch (e: unknown) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── list_files ────────────────────────────────────────────────────────────────
export async function listFiles(
  sandbox: SandboxContainer,
  dirPath: string = '.',
  maxDepth: number = 3,
): Promise<ToolResult> {
  try {
    const safe = safePath(dirPath);
    const result = await execInSandbox(sandbox, [
      'find', safe,
      '-maxdepth', String(maxDepth),
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.git/*',
      '-not', '-name', '*.lock',
      '-type', 'f',
    ]);
    if (result.exitCode !== 0) {
      return { ok: false, output: '', error: result.stderr };
    }
    return { ok: true, output: result.stdout };
  } catch (e: unknown) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── search_code ───────────────────────────────────────────────────────────────
export async function searchCode(
  sandbox: SandboxContainer,
  query: string,
  dirPath: string = '.',
): Promise<ToolResult> {
  try {
    const safe = safePath(dirPath);
    // grep: recursive, line numbers, no binary, exclude node_modules
    const result = await execInSandbox(sandbox, [
      'grep', '-rn', '--include=*.ts', '--include=*.js', '--include=*.mjs',
      '--exclude-dir=node_modules', '--exclude-dir=.git',
      query, safe,
    ]);
    // exitCode 1 just means "no matches" — not an error
    return { ok: true, output: result.stdout || '(no matches)' };
  } catch (e: unknown) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── write_file ────────────────────────────────────────────────────────────────
export async function writeFile(
  sandbox: SandboxContainer,
  filePath: string,
  content: string,
): Promise<ToolResult> {
  try {
    const safe = safePath(filePath);

    // Ensure parent directory exists
    const dir = path.posix.dirname(safe);
    await execInSandbox(sandbox, ['mkdir', '-p', dir]);

    // Write via sh to avoid shell injection (content goes over stdin-like heredoc via base64)
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    const result = await execInSandbox(sandbox, [
      'sh', '-c', `echo "${b64}" | base64 -d > "${safe}"`,
    ]);

    if (result.exitCode !== 0) {
      return { ok: false, output: '', error: result.stderr };
    }
    return { ok: true, output: `Written ${safe}` };
  } catch (e: unknown) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── run_tests ─────────────────────────────────────────────────────────────────
export interface TestRunResult {
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  output: string;
  exitCode: number;
}

/**
 * Detect and run the test suite inside the sandbox.
 * Supports Jest and Vitest (detected from package.json).
 * Returns structured pass/fail counts parsed from output.
 */
export async function runTests(
  sandbox: SandboxContainer,
  testFilter?: string,    // optional file/test name filter
  timeoutMs: number = 60_000,
): Promise<TestRunResult> {
  // Detect test runner from package.json
  const pkgResult = await execInSandbox(sandbox, ['cat', '/workspace/package.json']);
  const pkg = JSON.parse(pkgResult.stdout || '{}') as Record<string, unknown>;
  const runner = detectRunner(pkg);

  const cmd = buildTestCmd(runner, testFilter);

  const result = await execInSandbox(sandbox, ['sh', '-c', cmd], { timeoutMs });
  const combined = result.stdout + result.stderr;

  const counts = parseTestCounts(combined, runner);

  return {
    ok: result.exitCode === 0,
    passed: counts.passed,
    failed: counts.failed,
    total: counts.total,
    output: combined,
    exitCode: result.exitCode,
  };
}

export type TestRunner = 'vitest' | 'jest' | 'unknown';

export function detectRunner(pkg: Record<string, unknown>): TestRunner {
  const deps = {
    ...(pkg['dependencies'] as Record<string, unknown> ?? {}),
    ...(pkg['devDependencies'] as Record<string, unknown> ?? {}),
  };
  if ('vitest' in deps) return 'vitest';
  if ('jest' in deps) return 'jest';

  const scripts = pkg['scripts'] as Record<string, string> ?? {};
  if (Object.values(scripts).some((s) => s.includes('vitest'))) return 'vitest';
  if (Object.values(scripts).some((s) => s.includes('jest'))) return 'jest';

  return 'unknown';
}

export function buildTestCmd(runner: TestRunner, filter?: string): string {
  const f = filter ? `"${filter}"` : '';
  switch (runner) {
    case 'vitest':
      return `npx vitest run --reporter=verbose ${f} 2>&1 || true`;
    case 'jest':
      return `npx jest --no-coverage --verbose ${f} 2>&1 || true`;
    default:
      // Fall back to npm test
      return `npm test 2>&1 || true`;
  }
}

export function parseTestCounts(
  output: string,
  runner: TestRunner,
): { passed: number; failed: number; total: number } {
  let passed = 0;
  let failed = 0;

  if (runner === 'vitest') {
    // "Tests  3 passed | 1 failed (4)"
    const match = output.match(/Tests\s+(\d+)\s+passed(?:\s+\|\s+(\d+)\s+failed)?/);
    if (match) {
      passed = parseInt(match[1] ?? '0', 10);
      failed = parseInt(match[2] ?? '0', 10);
    }
    // Also try: "✓ X tests" / "× X tests"
    const passMatches = [...output.matchAll(/✓\s+(\d+)\s+test/g)];
    const failMatches = [...output.matchAll(/×\s+(\d+)\s+test/g)];
    if (passMatches.length > 0 || failMatches.length > 0) {
      passed = passMatches.reduce((s, m) => s + parseInt(m[1] ?? '0', 10), 0);
      failed = failMatches.reduce((s, m) => s + parseInt(m[1] ?? '0', 10), 0);
    }
  } else if (runner === 'jest') {
    const testsLineMatch = output.match(/Tests:\s+([^\n]+)/);
    if (testsLineMatch) {
      const line = testsLineMatch[1]!;
      const passMatch = line.match(/(\d+)\s+passed/);
      const failMatch = line.match(/(\d+)\s+failed/);
      if (passMatch) passed = parseInt(passMatch[1]!, 10);
      if (failMatch) failed = parseInt(failMatch[1]!, 10);
    }
  }

  return { passed, failed, total: passed + failed };
}
