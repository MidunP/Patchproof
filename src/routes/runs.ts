import { Router, Request, Response } from 'express';
import { listRuns, getRun, getLogsForRun, getStepsForRun } from '../db/runs';

const router = Router();

// GET /api/runs — list recent runs
router.get('/', async (_req: Request, res: Response) => {
  try {
    const runs = await listRuns(50);
    res.json(runs);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/runs/:id — single run with steps and logs
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const run = await getRun(req.params['id'] as string);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const [steps, logs] = await Promise.all([
      getStepsForRun(run.id),
      getLogsForRun(run.id),
    ]);

    res.json({ run, steps, logs });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
