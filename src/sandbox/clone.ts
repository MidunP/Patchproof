import os from 'os';
import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';
import { createSandbox, destroySandbox, type SandboxContainer } from './runner.js';
import { execInSandbox } from './executor.js';
import { runTests, type TestRunResult } from './tools.js';
import { appendLog } from '../db/runs.js';
import { config } from '../config.js';

export interface CloneAndInstallResult {
  sandbox: SandboxContainer;
  hostWorkDir: string;
  installLog: string;
}

/**
 * Clone a repo to a temp dir on the host, create the sandbox,
 * then install dependencies inside it.
 *
 * Cloning happens on the host (needs network).
 * npm install happens inside the sandbox (network enabled during install,
 * disabled for the rest of the run — we re-create the container after).
 */
export async function cloneAndInstall(
  repoUrl: string,
  runId: string,
): Promise<CloneAndInstallResult> {
  // 1. Clone onto host or copy demo seed into a temp dir
  const hostWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-'));

  let isDemoSeed = false;
  if (repoUrl.startsWith('demo:')) {
    const seedName = repoUrl.slice(5);
    const seedPath = path.resolve(process.cwd(), 'seeds', seedName);
    if (fs.existsSync(seedPath)) {
      await appendLog(runId, `Loading demo seed "${seedName}" into ${hostWorkDir}`, 'info', 'system');
      fs.cpSync(seedPath, hostWorkDir, { recursive: true });
      isDemoSeed = true;
    }
  } else if (fs.existsSync(repoUrl) && fs.statSync(repoUrl).isDirectory()) {
    await appendLog(runId, `Loading local directory "${repoUrl}" into ${hostWorkDir}`, 'info', 'system');
    fs.cpSync(repoUrl, hostWorkDir, { recursive: true });
    isDemoSeed = true;
  }

  // Ensure .gitignore exists and ignores node_modules so git never touches symlinks
  const gitignorePath = path.join(hostWorkDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "node_modules/\n.env\ndist/\n");
  } else {
    const existing = fs.readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes('node_modules')) {
      fs.appendFileSync(gitignorePath, "\nnode_modules/\n");
    }
  }

  if (isDemoSeed) {
    const git = simpleGit(hostWorkDir);
    await git.init();
    await git.addConfig('user.name', 'Repro Bot');
    await git.addConfig('user.email', 'repro-bot@users.noreply.github.com');
    await git.add('.');
    await git.commit('initial seed commit');
    await appendLog(runId, 'Demo seed initialized with git repository', 'info', 'system');
  } else {
    await appendLog(runId, `Cloning ${repoUrl} → ${hostWorkDir}`, 'info', 'system');
    const git = simpleGit();
    await git.clone(repoUrl, hostWorkDir, ['--depth=1']);
    await appendLog(runId, 'Clone complete', 'info', 'system');
  }

  // 2. Create sandbox WITH network for npm install
  const sandbox = await createSandboxWithNetwork(hostWorkDir);
  await appendLog(runId, `Sandbox created (id=${sandbox.id.slice(0, 12)})`, 'info', 'system');

  // 3. npm install inside sandbox
  await appendLog(runId, 'Running npm install...', 'info', 'sandbox');
  const installResult = await execInSandbox(
    sandbox,
    ['sh', '-c', 'npm install --prefer-offline 2>&1'],
    { timeoutMs: 120_000 },
  );
  await appendLog(runId, installResult.stdout, 'info', 'sandbox');

  if (installResult.exitCode !== 0) {
    await destroySandbox(sandbox);
    cleanupHostDir(hostWorkDir);
    throw new Error(`npm install failed (exit ${installResult.exitCode}): ${installResult.stderr}`);
  }
  await appendLog(runId, 'npm install complete', 'info', 'sandbox');

  // 4. Destroy sandbox, re-create WITHOUT network (the actual sandbox)
  await destroySandbox(sandbox);
  const isolatedSandbox = await createSandbox(hostWorkDir);
  await appendLog(runId, 'Sandbox re-created with network disabled', 'info', 'system');

  return {
    sandbox: isolatedSandbox,
    hostWorkDir,
    installLog: installResult.stdout,
  };
}

/**
 * Run the test suite and return structured results.
 * Used for the "baseline" check before and after patching.
 */
export async function runTestSuite(
  sandbox: SandboxContainer,
  runId: string,
  testFilter?: string,
): Promise<TestRunResult> {
  await appendLog(runId, `Running tests${testFilter ? ` (filter: ${testFilter})` : ''}`, 'info', 'sandbox');
  const result = await runTests(sandbox, testFilter, config.SANDBOX_TIMEOUT_MS);
  await appendLog(runId, result.output.slice(0, 2000), 'info', 'sandbox');
  await appendLog(
    runId,
    `Test result: ${result.passed} passed, ${result.failed} failed, exit=${result.exitCode}`,
    result.ok ? 'info' : 'warn',
    'sandbox',
  );
  return result;
}

/** Cleanup the host temp dir (best-effort) */
export function cleanupHostDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // not fatal
  }
}

// ── Internal: sandbox with network enabled for npm install only ────────────────
import Docker from 'dockerode';
import { docker } from './runner.js';
import { WORKSPACE } from './runner.js';

async function createSandboxWithNetwork(hostWorkDir: string): Promise<SandboxContainer> {
  const image = config.SANDBOX_IMAGE;
  const container = await docker.createContainer({
    Image: image,
    Cmd: ['sh', '-c', 'sleep infinity'],
    WorkingDir: WORKSPACE,
    NetworkDisabled: false, // network ON for install
    HostConfig: {
      Binds: [`${hostWorkDir}:${WORKSPACE}`],
      Memory: 1024 * 1024 * 1024, // 1GB for install
      AutoRemove: true,
    },
    Labels: { 'repro.sandbox': 'true', 'repro.phase': 'install' },
  });
  await container.start();
  return { id: container.id, container, workDir: WORKSPACE };
}
