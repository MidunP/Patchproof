import { getOctokit, parseRepoUrl } from './client';
import { simpleGit } from 'simple-git';
import type { GateResult } from '../verification/gate';
import { formatGateReport } from '../verification/gate';

export interface CreatePRInput {
  runId: string;
  repoUrl: string;
  issueNumber: number;
  issueTitle: string;
  reproductionTestPath: string;
  gateResult: GateResult;
  branchName: string;
}

/**
 * Create a pull request with the run report.
 * The branch must already be pushed to the remote before calling this.
 */
export async function createPR(input: CreatePRInput): Promise<string> {
  const { owner, repo } = parseRepoUrl(input.repoUrl);
  const octokit = getOctokit();

  const body = buildPRBody(input);

  const { data } = await octokit.pulls.create({
    owner,
    repo,
    title: `fix: ${input.issueTitle} (Repro #${input.runId.slice(0, 8)})`,
    head: input.branchName,
    base: 'main',
    body,
  });

  return data.html_url;
}

/** Push the local changes to a new branch on the remote */
export async function pushBranch(opts: {
  hostWorkDir: string;
  repoUrl: string;
  branchName: string;
  githubToken: string;
}): Promise<void> {
  const git = simpleGit(opts.hostWorkDir);

  // Embed token in remote URL for auth
  const authedUrl = opts.repoUrl.replace('https://', `https://${opts.githubToken}@`);

  await git.addConfig('user.name', 'Repro Bot');
  await git.addConfig('user.email', 'repro-bot@users.noreply.github.com');
  await git.checkout(['-b', opts.branchName]);
  await git.add('.');
  await git.commit(`fix: automated repro fix for issue (run ${opts.branchName})`);
  await git.push(['--set-upstream', authedUrl, opts.branchName]);
}

export function buildPRBody(input: CreatePRInput): string {
  return `## Automated fix by Repro

This PR was created automatically by [Repro](https://github.com/repro) in response to issue #${input.issueNumber}.

**Run ID:** \`${input.runId}\`
**Reproduction test:** \`${input.reproductionTestPath}\`

${formatGateReport(input.gateResult)}

---
*This PR was only opened because the reproduction test failed before the fix and passes after, and all existing tests still pass.*
`;
}
