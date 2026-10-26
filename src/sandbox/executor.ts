import Docker from 'dockerode';
import type { SandboxContainer } from './runner.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB truncation limit

/**
 * Execute a command inside a running sandbox container.
 * Captures stdout+stderr separately, enforces a timeout.
 */
export async function execInSandbox(
  sandbox: SandboxContainer,
  cmd: string[],
  opts: {
    workDir?: string;
    timeoutMs?: number;
    env?: string[];
  } = {},
): Promise<ExecResult> {
  const { workDir = '/workspace', timeoutMs = 60_000, env = [] } = opts;

  const exec = await sandbox.container.exec({
    Cmd: cmd,
    WorkingDir: workDir,
    Env: env,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise<ExecResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      stream.destroy();
      resolve({
        stdout: truncate(stdout),
        stderr: truncate(stderr) + '\n[TIMED OUT]',
        exitCode: 124, // same as GNU timeout
        timedOut: true,
      });
    }, timeoutMs);

    // dockerode multiplexes stdout/stderr on the same stream
    sandbox.container.modem.demuxStream(
      stream,
      { write: (chunk: Buffer) => { stdout += chunk.toString('utf-8'); } },
      { write: (chunk: Buffer) => { stderr += chunk.toString('utf-8'); } },
    );

    stream.on('end', async () => {
      if (timedOut) return;
      clearTimeout(timer);
      const inspect = await exec.inspect();
      resolve({
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        exitCode: inspect.ExitCode ?? 0,
        timedOut: false,
      });
    });

    stream.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: truncate(stdout),
        stderr: truncate(stderr) + `\n[STREAM ERROR: ${err.message}]`,
        exitCode: 1,
        timedOut: false,
      });
    });
  });
}

function truncate(s: string): string {
  if (Buffer.byteLength(s, 'utf-8') <= MAX_OUTPUT_BYTES) return s;
  const buf = Buffer.from(s, 'utf-8').slice(0, MAX_OUTPUT_BYTES);
  return buf.toString('utf-8') + '\n... [OUTPUT TRUNCATED]';
}
