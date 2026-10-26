import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../src/db/client', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
  },
}));

vi.mock('../src/queue/jobs', () => ({
  getQueue: vi.fn().mockReturnValue({
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  }),
  enqueueRun: vi.fn().mockResolvedValue('job-123'),
}));

vi.mock('../src/db/runs', () => ({
  createRun: vi.fn().mockResolvedValue({
    id: 'run-uuid-123',
    repo_url: 'https://github.com/foo/bar',
    issue_number: 42,
    status: 'queued',
  }),
  listRuns: vi.fn().mockResolvedValue([]),
  getRun: vi.fn().mockResolvedValue(null),
  getStepsForRun: vi.fn().mockResolvedValue([]),
  getLogsForRun: vi.fn().mockResolvedValue([]),
}));

import healthRouter from '../src/routes/health';
import triggerRouter from '../src/routes/trigger';
import runsRouter from '../src/routes/runs';

describe('HTTP Routes Integration', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/health', healthRouter);
    app.use('/api/trigger', triggerRouter);
    app.use('/api/runs', runsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /health returns 200 and checks when dependencies are healthy', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json() as { status: string; checks: Record<string, { ok: boolean }> };
    expect(data.status).toBe('ok');
    expect(data.checks.postgres.ok).toBe(true);
    expect(data.checks.redis.ok).toBe(true);
  });

  it('POST /api/trigger validates input and returns 400 on invalid payload', async () => {
    const res = await fetch(`${baseUrl}/api/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueNumber: -1 }), // missing repoUrl, negative issueNumber
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: unknown };
    expect(data.error).toBeDefined();
  });

  it('POST /api/trigger returns 201 with runId on valid payload', async () => {
    const res = await fetch(`${baseUrl}/api/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoUrl: 'https://github.com/foo/bar',
        issueNumber: 42,
        issueTitle: 'Sample bug',
        issueBody: 'Description',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { runId: string; status: string };
    expect(data.runId).toBe('run-uuid-123');
    expect(data.status).toBe('queued');
  });

  it('GET /api/runs/:id returns 404 when run is not found', async () => {
    const res = await fetch(`${baseUrl}/api/runs/non-existent-id`);
    expect(res.status).toBe(404);
  });
});
