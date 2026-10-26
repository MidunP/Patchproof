import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { createRun } from '../db/runs.js';
import { enqueueRun } from '../queue/jobs.js';

const router = Router();

// POST /webhook — GitHub issue webhook
router.post('/', async (req: Request, res: Response) => {
  // Verify webhook signature
  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = req.headers['x-github-event'] as string;

  // Only handle "issues" events with action "opened" or "labeled"
  if (event !== 'issues') {
    return res.status(200).json({ ok: true, skipped: true, event });
  }

  const payload = req.body as GitHubIssuePayload;

  if (!['opened', 'labeled'].includes(payload.action)) {
    return res.status(200).json({ ok: true, skipped: true, action: payload.action });
  }

  // Only trigger on "repro" label
  if (payload.action === 'labeled' && payload.label?.name !== 'repro') {
    return res.status(200).json({ ok: true, skipped: true, reason: 'not a repro label' });
  }

  const repoUrl = payload.repository.html_url;
  const issueNumber = payload.issue.number;
  const issueTitle = payload.issue.title;
  const issueBody = payload.issue.body ?? '';

  try {
    const run = await createRun({ repoUrl, issueNumber, issueTitle, issueBody });
    await enqueueRun({ runId: run.id, repoUrl, issueNumber, issueTitle, issueBody });

    console.log(`[webhook] Enqueued run ${run.id} for ${repoUrl}#${issueNumber}`);
    res.status(201).json({ runId: run.id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export function verifySignature(req: Request): boolean {
  const secret = config.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification in dev if not set

  const sig = req.headers['x-hub-signature-256'] as string;
  if (!sig) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Payload types ─────────────────────────────────────────────────────────────
interface GitHubIssuePayload {
  action: string;
  issue: { number: number; title: string; body: string | null };
  repository: { html_url: string };
  label?: { name: string };
}

export default router;
