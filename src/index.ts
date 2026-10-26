import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { runMigrations } from './db/migrations.js';
import { createWorker } from './queue/jobs.js';
import { processJob } from './queue/worker.js';
import healthRouter from './routes/health.js';
import runsRouter from './routes/runs.js';
import triggerRouter from './routes/trigger.js';
import webhookRouter from './github/webhook.js';
import { attachSseForRun, attachSseGlobal } from './sse/stream.js';

async function main() {
  // ── 1. Run DB migrations ───────────────────────────────────────────────────
  await runMigrations();

  // ── 2. Start BullMQ worker ─────────────────────────────────────────────────
  const worker = createWorker(processJob);
  console.log('[worker] BullMQ worker started (concurrency=2)');

  // ── 3. Build Express app ───────────────────────────────────────────────────
  const app = express();
  app.use(express.json());

  // Serve dashboard static files with dist/src fallback
  const dashboardDir = fs.existsSync(path.join(__dirname, 'dashboard'))
    ? path.join(__dirname, 'dashboard')
    : path.join(process.cwd(), 'src', 'dashboard');

  // Serve landing page static files with dist/src fallback
  const landingDir = fs.existsSync(path.join(__dirname, 'landing'))
    ? path.join(__dirname, 'landing')
    : path.join(process.cwd(), 'src', 'landing');

  // ── Landing page ────────────────────────────────────────────────────────────
  app.get('/', (_req, res) => {
    res.sendFile(path.join(landingDir, 'index.html'));
  });

  // ── App dashboard ───────────────────────────────────────────────────────────
  app.get('/app', (_req, res) => {
    res.sendFile(path.join(dashboardDir, 'index.html'));
  });

  // Serve dashboard static assets (CSS, JS, etc.) if any
  app.use('/app', express.static(dashboardDir));

  // ── API routes ─────────────────────────────────────────────────────────────
  app.use('/health', healthRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/trigger', triggerRouter);
  app.use('/webhook', webhookRouter);

  // ── SSE routes ─────────────────────────────────────────────────────────────
  app.get('/api/runs/:id/stream', (req, res) => {
    attachSseForRun(req.params.id, res);
  });

  app.get('/api/stream', (_req, res) => {
    attachSseGlobal(res);
  });

  // ── Fallback: serve dashboard for any unknown GET under /app ───────────────
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/webhook') && !req.path.startsWith('/health') && req.path !== '/') {
      res.sendFile(path.join(dashboardDir, 'index.html'));
      return;
    }
    next();
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
