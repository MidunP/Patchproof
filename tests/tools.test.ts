import {
  safePath,
  isWritePathAllowed,
  detectRunner,
  buildTestCmd,
  parseTestCounts,
} from '../src/sandbox/tools';
import { sanitizeMessage } from '../src/db/runs';

describe('safePath (Path Traversal Protection)', () => {
  it('allows safe relative paths inside workspace', () => {
    expect(safePath('src/index.ts')).toBe('/workspace/src/index.ts');
    expect(safePath('tests/foo.test.ts')).toBe('/workspace/tests/foo.test.ts');
    expect(safePath('./package.json')).toBe('/workspace/package.json');
    expect(safePath('.')).toBe('/workspace');
  });

  it('blocks ../ path traversal attempts out of workspace', () => {
    expect(() => safePath('../etc/passwd')).toThrow(/Path traversal attempt blocked/);
    expect(() => safePath('../../secret.env')).toThrow(/Path traversal attempt blocked/);
    expect(() => safePath('foo/../../bar')).toThrow(/Path traversal attempt blocked/);
  });

  it('blocks absolute paths targeting outside workspace', () => {
    expect(() => safePath('/etc/passwd')).toThrow(/Path traversal attempt blocked/);
    expect(() => safePath('/root/.ssh/id_rsa')).toThrow(/Path traversal attempt blocked/);
  });

  it('blocks Windows backslash path traversal attempts', () => {
    expect(() => safePath('..\\..\\windows\\system32')).toThrow(/Path traversal attempt blocked/);
  });
});

describe('detectRunner', () => {
  it('detects vitest in dependencies', () => {
    expect(detectRunner({ dependencies: { vitest: '^1.0.0' } })).toBe('vitest');
  });

  it('detects vitest in devDependencies', () => {
    expect(detectRunner({ devDependencies: { vitest: '^1.0.0' } })).toBe('vitest');
  });

  it('detects jest in devDependencies', () => {
    expect(detectRunner({ devDependencies: { jest: '^29.0.0' } })).toBe('jest');
  });

  it('detects vitest from scripts', () => {
    expect(detectRunner({ scripts: { test: 'vitest run' } })).toBe('vitest');
  });

  it('detects jest from scripts', () => {
    expect(detectRunner({ scripts: { test: 'jest' } })).toBe('jest');
  });

  it('returns unknown when neither is configured', () => {
    expect(detectRunner({ scripts: { test: 'mocha' } })).toBe('unknown');
    expect(detectRunner({})).toBe('unknown');
  });
});

describe('buildTestCmd', () => {
  it('builds vitest command without filter', () => {
    const cmd = buildTestCmd('vitest');
    expect(cmd).toContain('vitest run');
    expect(cmd).toContain('--reporter=verbose');
  });

  it('builds vitest command with filter', () => {
    const cmd = buildTestCmd('vitest', 'tests/math.test.ts');
    expect(cmd).toContain('"tests/math.test.ts"');
  });

  it('builds jest command with filter', () => {
    const cmd = buildTestCmd('jest', 'tests/user.test.ts');
    expect(cmd).toContain('jest');
    expect(cmd).toContain('"tests/user.test.ts"');
  });

  it('falls back to npm test for unknown runner', () => {
    expect(buildTestCmd('unknown')).toContain('npm test');
  });
});

describe('parseTestCounts', () => {
  it('parses Vitest summary format', () => {
    const output = `
      Test Files  1 passed (1)
           Tests  5 passed | 2 failed (7)
        Start at  12:00:00
    `;
    const counts = parseTestCounts(output, 'vitest');
    expect(counts.passed).toBe(5);
    expect(counts.failed).toBe(2);
    expect(counts.total).toBe(7);
  });

  it('parses Vitest checkmark output format', () => {
    const output = `
      ✓ 3 tests passed
      × 1 test failed
    `;
    const counts = parseTestCounts(output, 'vitest');
    expect(counts.passed).toBe(3);
    expect(counts.failed).toBe(1);
    expect(counts.total).toBe(4);
  });

  it('parses Jest summary format', () => {
    const output = `
      Tests:       2 failed, 8 passed, 10 total
      Snapshots:   0 total
      Time:        1.234 s
    `;
    const counts = parseTestCounts(output, 'jest');
    expect(counts.passed).toBe(8);
    expect(counts.failed).toBe(2);
    expect(counts.total).toBe(10);
  });
});

describe('isWritePathAllowed (System File Protection)', () => {
  it('allows writes to standard project files', () => {
    expect(isWritePathAllowed('/workspace/src/math.ts')).toBe(true);
    expect(isWritePathAllowed('/workspace/tests/repro.test.ts')).toBe(true);
    expect(isWritePathAllowed('/workspace/package.json')).toBe(true);
  });

  it('blocks writes to .git directory and hooks', () => {
    expect(isWritePathAllowed('/workspace/.git/config')).toBe(false);
    expect(isWritePathAllowed('/workspace/.git/hooks/pre-commit')).toBe(false);
  });

  it('blocks writes to .github workflows', () => {
    expect(isWritePathAllowed('/workspace/.github/workflows/ci.yml')).toBe(false);
  });

  it('blocks writes to .env files', () => {
    expect(isWritePathAllowed('/workspace/.env')).toBe(false);
    expect(isWritePathAllowed('/workspace/.env.local')).toBe(false);
    expect(isWritePathAllowed('/workspace/.env.production')).toBe(false);
  });
});

describe('sanitizeMessage (Telemetry Secret Scrubbing)', () => {
  it('scrubs GitHub Personal Access Tokens', () => {
    const raw = 'Pushing to remote with token ghp_1234567890abcdef1234567890';
    expect(sanitizeMessage(raw)).toBe('Pushing to remote with token ghp_***');
  });

  it('scrubs OpenAI API keys', () => {
    const raw = 'LLM authentication failed: sk-abcdef1234567890abcdef1234567890';
    expect(sanitizeMessage(raw)).toBe('LLM authentication failed: sk-***');
  });

  it('scrubs database passwords from connection strings', () => {
    const raw = 'Connected to postgresql://repro_user:SuperSecretPassword123@localhost:5432/repro';
    expect(sanitizeMessage(raw)).toBe('Connected to postgresql://repro_user:***@localhost:5432/repro');
  });

  it('scrubs Bearer tokens', () => {
    const raw = 'Authorization header: Bearer abcdef1234567890abcdef123456';
    expect(sanitizeMessage(raw)).toBe('Authorization header: Bearer ***');
  });
});
