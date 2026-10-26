import express from 'express';
import path from 'path';
import { config } from './config';
import { runMigrations } from './db/migrations';
import { createWorker } from './queue/jobs';
import { processJob } from './queue/worker';
import healthRouter from './routes/health';
import runsRouter from './routes/runs';
import triggerRouter from './routes/trigger';
import { attachSseForRun, attachSseGlobal } from './sse/stream';

async function main() {
  // ── 1. Run DB migrations ───────────────────────────────────────────────────
  await runMigrations();

  // ── 2. Start BullMQ worker ─────────────────────────────────────────────────
  const worker = createWorker(processJob);
  console.log('[worker] BullMQ worker started (concurrency=2)');

  // ── 3. Build Express app ───────────────────────────────────────────────────
  const app = express();
  app.use(express.json());

  // Serve dashboard static files
  app.use(express.static(path.join(__dirname, 'dashboard')));

  // ── API routes ─────────────────────────────────────────────────────────────
  app.use('/health', healthRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/trigger', triggerRouter);

  // ── SSE routes ─────────────────────────────────────────────────────────────
  app.get('/api/runs/:id/stream', (req, res) => {
    attachSseForRun(req.params.id, res);
  });

  app.get('/api/stream', (_req, res) => {
    attachSseGlobal(res);
  });

  // ── Fallback: serve dashboard for any unknown GET ──────────────────────────
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
  });

  // ── 4. Start listening ─────────────────────────────────────────────────────
  const server = app.listen(config.PORT, () => {
    console.log(`[server] Repro listening on http://localhost:${config.PORT}`);
    console.log(`[server] Health: http://localhost:${config.PORT}/health`);
  });

  // ── 5. Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received — shutting down`);
    server.close();
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
