import Docker from 'dockerode';
import path from 'path';
import { config } from '../config.js';

export const docker = new Docker();

export interface SandboxOptions {
  image?: string;
  cpuQuota?: number;
  memLimit?: string;
  timeoutMs?: number;
  workDir?: string;
}

export interface SandboxContainer {
  id: string;
  container: Docker.Container;
  workDir: string;
  hostWorkDir?: string;
}

const WORKSPACE = '/workspace';

/**
 * Create and start an isolated Docker container.
 * - No network after creation (NetworkMode: none)
 * - CPU and memory limited
 * - /workspace bind-mounted from a temp dir on the host
 */
export async function createSandbox(
  hostWorkDir: string,
  opts: SandboxOptions = {},
): Promise<SandboxContainer> {
  const image = opts.image ?? config.SANDBOX_IMAGE;
  const cpuQuota = opts.cpuQuota ?? config.SANDBOX_CPU_QUOTA;
  const memLimit = opts.memLimit ?? config.SANDBOX_MEM_LIMIT;

  // Ensure image exists locally (pull if needed)
  await ensureImage(image);

  const container = await docker.createContainer({
    Image: image,
    Cmd: ['sh', '-c', 'sleep infinity'], // keep alive
    WorkingDir: WORKSPACE,
    NetworkDisabled: true, // ← no network
    HostConfig: {
      Binds: [`${hostWorkDir}:${WORKSPACE}`],
      CpuQuota: cpuQuota,
      CpuPeriod: 100_000,
      Memory: parseMemLimit(memLimit),
      MemorySwap: parseMemLimit(memLimit), // disable swap
      AutoRemove: true,
      ReadonlyRootfs: false,
      SecurityOpt: ['no-new-privileges'],
    },
    Labels: { 'repro.sandbox': 'true' },
  });

  await container.start();

  // Air-gapped containers (NetworkDisabled: true) in Alpine Linux lack localhost in /etc/hosts.
  // Vitest and Node require localhost to resolve loopback IPC without EAI_AGAIN.
  try {
    const execHosts = await container.exec({
      Cmd: ['sh', '-c', 'echo "127.0.0.1 localhost" >> /etc/hosts'],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await execHosts.start({ hijack: true, stdin: false });
    await new Promise<void>((resolve) => {
      container.modem.demuxStream(stream, { write: () => {} }, { write: () => {} });
      stream.on('end', resolve);
      stream.on('error', resolve);
      setTimeout(resolve, 3000);
    });
  } catch {
    // best-effort
  }

  return {
    id: container.id,
    container,
    workDir: WORKSPACE,
    hostWorkDir,
  };
}

/**
 * Destroy a sandbox container (best-effort; container may already be gone).
 */
export async function destroySandbox(sandbox: SandboxContainer): Promise<void> {
  try {
    await sandbox.container.kill();
  } catch {
    // already gone
  }
}

/** Pull an image if it isn't already present locally */
async function ensureImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
  } catch {
    console.log(`[sandbox] Pulling image ${image}...`);
    await new Promise<void>((resolve, reject) => {
      docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err2: Error | null) => {
          if (err2) reject(err2);
          else resolve();
        });
      });
    });
    console.log(`[sandbox] Image ${image} ready`);
  }
}

/** Convert memory limit string (e.g. "512m", "1g") to bytes */
export function parseMemLimit(limit: string): number {
  const lower = limit.toLowerCase();
  if (lower.endsWith('g')) return parseFloat(lower) * 1024 * 1024 * 1024;
  if (lower.endsWith('m')) return parseFloat(lower) * 1024 * 1024;
  if (lower.endsWith('k')) return parseFloat(lower) * 1024;
  return parseInt(lower, 10);
}

export { WORKSPACE };
