import { query, queryOne } from '../db/client';

export type RunStatus =
  | 'queued'
  | 'cloning'
  | 'reproducing'
  | 'patching'
  | 'verifying'
  | 'pr_opened'
  | 'failed';

export interface Run extends Record<string, unknown> {
  id: string;
  repo_url: string;
  issue_number: number;
  issue_title: string;
  issue_body: string;
  status: RunStatus;
  attempt: number;
  pr_url: string | null;
  failure_reason: string | null;
  token_usage: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRunInput {
  repoUrl: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
}

/** Create a new run in 'queued' state */
export async function createRun(input: CreateRunInput): Promise<Run> {
  const row = await queryOne<Run>(
    `INSERT INTO runs (repo_url, issue_number, issue_title, issue_body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.repoUrl, input.issueNumber, input.issueTitle, input.issueBody],
  );
  if (!row) throw new Error('Failed to create run');
  return row;
}

/** Transition a run to a new status and record the step */
export async function transitionRun(
  runId: string,
  status: RunStatus,
  detail?: Record<string, unknown>,
): Promise<Run> {
  // Update run atomically in a transaction
  const { rows } = await query<Run>(
    `UPDATE runs SET status = $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [status, runId],
  );
  const run = rows[0];
  if (!run) throw new Error(`Run ${runId} not found`);

  // Record step (immutable audit)
  await query(
    `INSERT INTO steps (run_id, status, attempt, detail) VALUES ($1, $2, $3, $4)`,
    [runId, status, run.attempt, detail ? JSON.stringify(detail) : null],
  );

  return run;
}

/** Update attempt counter and optional fields */
export async function updateRun(
  runId: string,
  fields: Partial<Pick<Run, 'attempt' | 'pr_url' | 'failure_reason' | 'token_usage'>>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = $${idx++}`);
    values.push(val);
  }
  if (sets.length === 0) return;
  values.push(runId);
  await query(`UPDATE runs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
}

export async function getRun(runId: string): Promise<Run | null> {
  return queryOne<Run>(`SELECT * FROM runs WHERE id = $1`, [runId]);
}

export async function listRuns(limit = 20): Promise<Run[]> {
  const { rows } = await query<Run>(
    `SELECT * FROM runs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Append a log line to the logs table */
export async function appendLog(
  runId: string,
  message: string,
  level: 'info' | 'warn' | 'error' | 'debug' = 'info',
  source: 'agent' | 'sandbox' | 'system' = 'system',
): Promise<void> {
  await query(
    `INSERT INTO logs (run_id, level, source, message) VALUES ($1, $2, $3, $4)`,
    [runId, level, source, message],
  );
}

/** Fetch log lines for a run (ordered chronologically) */
export async function getLogsForRun(
  runId: string,
  since?: Date,
): Promise<Array<{ id: number; level: string; source: string; message: string; created_at: Date }>> {
  if (since) {
    const { rows } = await query(
      `SELECT id, level, source, message, created_at FROM logs
       WHERE run_id = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [runId, since],
    );
    return rows as Array<{ id: number; level: string; source: string; message: string; created_at: Date }>;
  }
  const { rows } = await query(
    `SELECT id, level, source, message, created_at FROM logs
     WHERE run_id = $1 ORDER BY created_at ASC`,
    [runId],
  );
  return rows as Array<{ id: number; level: string; source: string; message: string; created_at: Date }>;
}

/** Get all steps for a run */
export async function getStepsForRun(runId: string) {
  const { rows } = await query(
    `SELECT * FROM steps WHERE run_id = $1 ORDER BY created_at ASC`,
    [runId],
  );
  return rows;
}
