import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createRun } from '../db/runs';
import { enqueueRun } from '../queue/jobs';

const router = Router();

const TriggerBody = z.object({
  repoUrl: z.string().url('Must be a valid GitHub URL'),
  issueNumber: z.number().int().positive(),
  issueTitle: z.string().default(''),
  issueBody: z.string().default(''),
});

// POST /api/trigger — manually kick off a run
router.post('/', async (req: Request, res: Response) => {
  const parsed = TriggerBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { repoUrl, issueNumber, issueTitle, issueBody } = parsed.data;

  try {
    const run = await createRun({ repoUrl, issueNumber, issueTitle, issueBody });
    await enqueueRun({
      runId: run.id,
      repoUrl,
      issueNumber,
      issueTitle,
      issueBody,
    });

    res.status(201).json({ runId: run.id, status: run.status });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
