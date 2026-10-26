import { Octokit } from '@octokit/rest';
import { config } from '../config';

let _octokit: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!_octokit) {
    _octokit = new Octokit({ auth: config.GITHUB_TOKEN });
  }
  return _octokit;
}

/** Parse owner/repo from a GitHub URL */
export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/);
  if (!match) throw new Error(`Cannot parse GitHub URL: ${url}`);
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/, '') };
}

/** Fetch issue details from GitHub */
export async function fetchIssue(
  repoUrl: string,
  issueNumber: number,
): Promise<{ title: string; body: string }> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const octokit = getOctokit();
  const { data } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
  return { title: data.title, body: data.body ?? '' };
}
