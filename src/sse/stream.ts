import { Response } from 'express';
import { EventEmitter } from 'events';

// ── In-process event bus for SSE ─────────────────────────────────────────────
// Simple: one emitter per process. For multi-process, replace with Redis pub/sub.
// Design note: this is intentionally simple — noted as a limitation in the README.
export const sseEmitter = new EventEmitter();
sseEmitter.setMaxListeners(200); // up to 200 concurrent SSE clients

export interface LogEvent {
  runId: string;
  level: string;
  source: string;
  message: string;
  ts: string;
}

export interface StatusEvent {
  runId: string;
  status: string;
  attempt?: number;
  ts: string;
}

/** Emit a log line to all SSE clients watching a run */
export function emitLog(event: LogEvent): void {
  sseEmitter.emit(`run:${event.runId}:log`, event);
  sseEmitter.emit('all:log', event); // dashboard "all runs" view
}

/** Emit a status change to all SSE clients watching a run */
export function emitStatus(event: StatusEvent): void {
  sseEmitter.emit(`run:${event.runId}:status`, event);
  sseEmitter.emit('all:status', event);
}

/**
 * Attach an SSE connection for a specific run.
 * Sends keep-alive comments every 15s.
 */
export function attachSseForRun(runId: string, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const send = (eventName: string, data: unknown) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onLog = (e: LogEvent) => send('log', e);
  const onStatus = (e: StatusEvent) => send('status', e);

  sseEmitter.on(`run:${runId}:log`, onLog);
  sseEmitter.on(`run:${runId}:status`, onStatus);

  // Keep-alive ping
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);

  res.on('close', () => {
    clearInterval(ping);
    sseEmitter.off(`run:${runId}:log`, onLog);
    sseEmitter.off(`run:${runId}:status`, onStatus);
  });
}

/**
 * Attach a global SSE stream (all runs).
 */
export function attachSseGlobal(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (eventName: string, data: unknown) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onLog = (e: LogEvent) => send('log', e);
  const onStatus = (e: StatusEvent) => send('status', e);

  sseEmitter.on('all:log', onLog);
  sseEmitter.on('all:status', onStatus);

  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);

  res.on('close', () => {
    clearInterval(ping);
    sseEmitter.off('all:log', onLog);
    sseEmitter.off('all:status', onStatus);
  });
}
