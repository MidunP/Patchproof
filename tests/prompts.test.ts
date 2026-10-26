import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from '../src/agent/prompts';

describe('buildSystemPrompt', () => {
  it('includes key agent constraints and rules', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('You are Repro');
    expect(prompt).toContain('/workspace');
    expect(prompt).toContain('NEVER read or write files outside /workspace');
    expect(prompt).toContain('reproduction test MUST fail before the fix');
    expect(prompt).toContain('stop_agent');
    expect(prompt).toContain('write_file');
    expect(prompt).toContain('run_tests');
  });
});

describe('buildUserPrompt', () => {
  const baseOpts = {
    repoUrl: 'https://github.com/example/demo',
    issueNumber: 101,
    issueTitle: 'Off-by-one in pagination offset',
    issueBody: 'Pagination returns page 2 with offset 0 instead of 10',
  };

  it('builds Phase 1 (reproduce) prompt instructing to write failing test', () => {
    const prompt = buildUserPrompt({
      ...baseOpts,
      phase: 'reproduce',
    });

    expect(prompt).toContain('## GitHub Issue');
    expect(prompt).toContain('Issue #101: Off-by-one in pagination offset');
    expect(prompt).toContain('## Your task (Phase 1: Reproduce)');
    expect(prompt).toContain('Write a test that FAILS because of this bug');
    expect(prompt).toContain('reason "reproduced"');
  });

  it('builds Phase 2 (patch) prompt instructing to fix and verify', () => {
    const prompt = buildUserPrompt({
      ...baseOpts,
      phase: 'patch',
    });

    expect(prompt).toContain('## GitHub Issue');
    expect(prompt).toContain('## Your task (Phase 2: Patch)');
    expect(prompt).toContain('reproduction test is already written and failing');
    expect(prompt).toContain('reason "done"');
  });

  it('includes previous attempts if provided', () => {
    const prompt = buildUserPrompt({
      ...baseOpts,
      phase: 'patch',
      previousAttempts: 'Attempt 1: TypeError on null user',
    });

    expect(prompt).toContain('## Previous patch attempts (failed)');
    expect(prompt).toContain('Attempt 1: TypeError on null user');
  });
});
