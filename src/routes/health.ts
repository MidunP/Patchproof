import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { getQueue } from '../queue/jobs';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // ── Postgres ──────────────────────────────────────────────────────────────
  try {
    await pool.query('SELECT 1');
    checks.postgres = { ok: true };
  } catch (err: unknown) {
    checks.postgres = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  // ── Redis / BullMQ ────────────────────────────────────────────────────────
  try {
    const queue = getQueue();
    await queue.getJobCounts();
    checks.redis = { ok: true };
  } catch (err: unknown) {
    checks.redis = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    checks,
    ts: new Date().toISOString(),
  });
});

export default router;
