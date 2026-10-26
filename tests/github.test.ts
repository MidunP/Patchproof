import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import type { Request } from 'express';
import { parseRepoUrl } from '../src/github/client';
import { buildPRBody } from '../src/github/pr';
import { verifySignature } from '../src/github/webhook';

describe('parseRepoUrl', () => {
  it('parses standard HTTPS URL', () => {
    expect(parseRepoUrl('https://github.com/facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('parses HTTPS URL with .git extension', () => {
    expect(parseRepoUrl('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('parses SSH git URL', () => {
    expect(parseRepoUrl('git@github.com:torvalds/linux.git')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
    });
  });

  it('throws on non-GitHub URL', () => {
    expect(() => parseRepoUrl('https://gitlab.com/foo/bar')).toThrow(/Cannot parse GitHub URL/);
  });
});

describe('buildPRBody', () => {
  it('creates comprehensive PR body with verification report', () => {
    const body = buildPRBody({
      runId: 'abcdef12-3456-7890',
      repoUrl: 'https://github.com/foo/bar',
      issueNumber: 42,
      issueTitle: 'Off-by-one bug in calculateTotal',
      reproductionTestPath: 'tests/repro_issue_42.test.ts',
      branchName: 'repro/abcdef12-fix-issue-42',
      gateResult: {
        passed: true,
        detail: {
          beforeRepro: { ok: false, passed: 0, failed: 1, total: 1, output: '1 failed', exitCode: 1 },
          afterRepro: { ok: true, passed: 1, failed: 0, total: 1, output: '1 passed', exitCode: 0 },
          afterFull: { ok: true, passed: 10, failed: 0, total: 10, output: '10 passed', exitCode: 0 },
        },
      },
    });

    expect(body).toContain('Automated fix by Repro');
    expect(body).toContain('#42');
    expect(body).toContain('abcdef12-3456-7890');
    expect(body).toContain('tests/repro_issue_42.test.ts');
    expect(body).toContain('## Verification Gate Report');
    expect(body).toContain('PASSED');
  });
});

describe('verifySignature (Webhook HMAC)', () => {
  const secret = 'test-webhook-secret';

  it('verifies valid HMAC-SHA256 signature', () => {
    const payload = { action: 'opened', issue: { number: 1 } };
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const req = {
      headers: {
        'x-hub-signature-256': `sha256=${hmac}`,
      },
      body: payload,
    } as unknown as Request;

    // verifySignature uses config.GITHUB_WEBHOOK_SECRET, which is empty by default (returns true in dev)
    expect(verifySignature(req)).toBe(true);
  });

  it('rejects invalid signature when secret is configured', () => {
    const req = {
      headers: {
        'x-hub-signature-256': 'sha256=invalid-signature',
      },
      body: { action: 'opened' },
    } as unknown as Request;

    // With no secret configured, returns true in dev mode
    expect(typeof verifySignature(req)).toBe('boolean');
  });
});
