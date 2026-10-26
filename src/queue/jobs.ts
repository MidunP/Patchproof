import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

// ── Job payload type ─────────────────────────────────────────────────────────
export interface ReproJobData {
  runId: string;
  repoUrl: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
}

// ── Queue name ───────────────────────────────────────────────────────────────
export const QUEUE_NAME = 'repro';

// ── Shared Redis connection (BullMQ requires a dedicated connection) ──────────
export function createRedisConnection(): IORedis {
  return new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
}

// ── Queue (used by the API to enqueue jobs) ───────────────────────────────────
let _queue: Queue<ReproJobData> | null = null;

export function getQueue(): Queue<ReproJobData> {
  if (!_queue) {
    _queue = new Queue<ReproJobData>(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 1,          // we manage retries ourselves inside the agent
        removeOnComplete: 50, // keep last 50 completed jobs in Redis
        removeOnFail: 100,
      },
    });
  }
  return _queue;
}

/** Enqueue a repro job. Returns the BullMQ job ID. */
export async function enqueueRun(data: ReproJobData): Promise<string> {
  const queue = getQueue();
  const job = await queue.add('repro', data, { jobId: data.runId });
  return job.id ?? data.runId;
}

// ── Worker factory ────────────────────────────────────────────────────────────
// The actual processor is injected so this file stays import-free of the
// heavy sandbox/agent modules (keeps tests fast).
export type JobProcessor = (job: Job<ReproJobData>) => Promise<void>;

export function createWorker(processor: JobProcessor): Worker<ReproJobData> {
  const worker = new Worker<ReproJobData>(QUEUE_NAME, processor, {
    connection: createRedisConnection(),
    concurrency: 2, // max 2 parallel sandboxes
  });

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
