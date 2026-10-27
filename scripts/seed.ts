import { query } from '../src/db/client.js';

async function seed() {
  console.log('Seeding initial verification runs for dashboard telemetry...');

  // Run 1: Verified and PR opened
  const run1Res = await query<{ id: string }>(
    `INSERT INTO runs (repo_url, issue_number, issue_title, issue_body, status, attempt, pr_url, token_usage, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '6 minutes', NOW())
     RETURNING id`,
    [
      'https://github.com/acme/payment-service',
      142,
      'TypeError: Cannot read properties of null (reading "displayName")',
      'When formatting user lists containing null or guest accounts, formatUserList throws an unhandled TypeError instead of defaulting to "Anonymous".',
      'pr_opened',
      1,
      'https://github.com/acme/payment-service/pull/143',
      14820
    ]
  );
  const run1Id = run1Res.rows[0].id;

  const steps = [
    { status: 'queued', offset: '6 minutes' },
    { status: 'cloning', offset: '5 minutes' },
    { status: 'reproducing', offset: '4 minutes' },
    { status: 'patching', offset: '3 minutes' },
    { status: 'verifying', offset: '1 minutes' },
    { status: 'pr_opened', offset: '30 seconds' }
  ];

  for (const s of steps) {
    await query(
      `INSERT INTO steps (run_id, status, attempt, detail, created_at)
       VALUES ($1, $2, 1, $3, NOW() - INTERVAL '${s.offset}')`,
      [run1Id, s.status, JSON.stringify({ state: s.status, verified: true })]
    );
  }

  const logs = [
    { level: 'info', source: 'system', msg: 'Job received from queue. Initializing Docker sandbox container...', offset: '5 minutes 50 seconds' },
    { level: 'info', source: 'sandbox', msg: 'Cloned repository acme/payment-service (commit: e9a2f7c)', offset: '5 minutes 20 seconds' },
    { level: 'info', source: 'sandbox', msg: 'Container network dropped (NetworkDisabled: true). Air-gapped sandbox active.', offset: '4 minutes 55 seconds' },
    { level: 'info', source: 'agent', msg: 'Searching codebase for formatUserList symbol and reading test/user.test.ts...', offset: '4 minutes 30 seconds' },
    { level: 'info', source: 'agent', msg: 'Writing reproduction test in test/repro_null_user.test.ts', offset: '4 minutes 05 seconds' },
    { level: 'warn', source: 'sandbox', msg: 'Repro test run: 1 failed, 0 passed. (TypeError: Cannot read properties of null at formatUserList)', offset: '3 minutes 45 seconds' },
    { level: 'info', source: 'agent', msg: 'Confirmed deterministic failure before fix with assertion crash diagnostics.', offset: '3 minutes 30 seconds' },
    { level: 'info', source: 'agent', msg: 'Synthesized patch in src/formatters/user.ts with nullish coalescing default.', offset: '2 minutes 45 seconds' },
    { level: 'info', source: 'system', msg: 'Entering Verification Gate...', offset: '2 minutes 00 seconds' },
    { level: 'info', source: 'system', msg: '[Gate Step 0] SHA-256 test integrity check: 8f3c7e... (UNMODIFIED)', offset: '1 minute 50 seconds' },
    { level: 'info', source: 'sandbox', msg: '[Gate Step 1] Repro test after fix: 1 passed, 0 failed. (SUCCESS)', offset: '1 minute 35 seconds' },
    { level: 'info', source: 'sandbox', msg: '[Gate Step 2] Full test suite run: 48 passed, 0 failed, 0 regressions. (SUCCESS)', offset: '1 minute 15 seconds' },
    { level: 'info', source: 'sandbox', msg: '[Gate Step 3] Git stash differential: repro test re-run against base tree FAILS as expected. (SUCCESS)', offset: '55 seconds' },
    { level: 'info', source: 'system', msg: '[Gate Step 4] Restored candidate patch. All formal invariants verified.', offset: '40 seconds' },
    { level: 'info', source: 'system', msg: 'Pushing branch repro/fix-issue-142 to origin and opening pull request...', offset: '25 seconds' },
    { level: 'info', source: 'system', msg: 'Pull Request opened: https://github.com/acme/payment-service/pull/143 with verified run report.', offset: '10 seconds' },
  ];

  for (const l of logs) {
    await query(
      `INSERT INTO logs (run_id, level, source, message, created_at)
       VALUES ($1, $2, $3, $4, NOW() - INTERVAL '${l.offset}')`,
      [run1Id, l.level, l.source, l.msg]
    );
  }

  // Run 2: Active / Verifying run
  const run2Res = await query<{ id: string }>(
    `INSERT INTO runs (repo_url, issue_number, issue_title, issue_body, status, attempt, pr_url, token_usage, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '2 minutes', NOW())
     RETURNING id`,
    [
      'https://github.com/fastify/rate-limiter',
      88,
      'Off-by-one window expiry in token bucket sliding limiter',
      'Window upper bound comparison uses <= instead of < causing requests on exact millisecond boundaries to be rejected prematurely.',
      'verifying',
      1,
      null,
      9430
    ]
  );
  const run2Id = run2Res.rows[0].id;

  const run2Steps = [
    { status: 'queued', offset: '2 minutes' },
    { status: 'cloning', offset: '90 seconds' },
    { status: 'reproducing', offset: '60 seconds' },
    { status: 'patching', offset: '30 seconds' },
    { status: 'verifying', offset: '5 seconds' },
  ];

  for (const s of run2Steps) {
    await query(
      `INSERT INTO steps (run_id, status, attempt, detail, created_at)
       VALUES ($1, $2, 1, $3, NOW() - INTERVAL '${s.offset}')`,
      [run2Id, s.status, JSON.stringify({ state: s.status })]
    );
  }

  const run2Logs = [
    { level: 'info', source: 'system', msg: 'Triggered run via Webhook for fastify/rate-limiter #88', offset: '110 seconds' },
    { level: 'info', source: 'sandbox', msg: 'Cloned into isolated Docker container (commit 381a90c)', offset: '85 seconds' },
    { level: 'info', source: 'agent', msg: 'Created reproduction test in test/repro_boundary.test.ts', offset: '55 seconds' },
    { level: 'warn', source: 'sandbox', msg: 'Repro test FAILED on boundary timestamp condition as expected.', offset: '40 seconds' },
    { level: 'info', source: 'agent', msg: 'Applying patch to src/limiter.ts: adjusting window comparison boundary.', offset: '20 seconds' },
    { level: 'info', source: 'system', msg: 'Running Verification Gate: verifying candidate patch against differential test suite...', offset: '5 seconds' },
  ];

  for (const l of run2Logs) {
    await query(
      `INSERT INTO logs (run_id, level, source, message, created_at)
       VALUES ($1, $2, $3, $4, NOW() - INTERVAL '${l.offset}')`,
      [run2Id, l.level, l.source, l.msg]
    );
  }

  console.log('Successfully seeded demo runs!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
