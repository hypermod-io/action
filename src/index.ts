import path from "path";
import fs from "fs-extra";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { getExecOutput } from "@actions/exec";

import {
  switchToMaybeExistingBranch,
  reset,
  commitAll,
  setupUser,
  push,
  status,
} from "./git";
import { setupOctokit } from "./octokit";

interface Source {
  id: string;
  name: string;
  code: string;
}

interface Deployment {
  id: string;
  title: string;
  description: string;
  transforms: Record<string, Source[]>;
}

const githubToken = process.env.GITHUB_TOKEN!;
const HYPERMOD_DIR = ".hypermod";

(async () => {
  if (!githubToken) {
    core.setFailed("Please add the GITHUB_TOKEN to the hypermod workflow file");
    return;
  }

  core.info("@hypermod: Setting git user\n");
  await setupUser();

  await fs.writeFile(
    `${process.env.HOME}/.netrc`,
    `machine github.com\nlogin github-actions[bot]\npassword ${githubToken}`
  );

  core.info("@hypermod: Preparing fresh branch\n");

  const deploymentId = core.getInput("deploymentId");
  const repo = `${github.context.repo.owner}/${github.context.repo.repo}`;
  const branchName = `hypermod-transform/${deploymentId}`;
  const branch = github.context.ref.replace("refs/heads/", "");

  await switchToMaybeExistingBranch(branchName);
  await reset(github.context.sha);

  core.info(`Fetching and running provided deployment: ${deploymentId}`);

  const deployment: Deployment = await fetch(
    `https://hypermod.vercel.app/api/action/${deploymentId}/deployment${repo}`
  ).then((res) => res.json());

  core.info(
    `@hypermod: Fetching transform source files: ${Object.keys(
      deployment.transforms
    ).join(",")}`
  );

  const transformPaths: string[] = [];

  Object.entries(deployment.transforms).forEach(([id, sources]) => {
    sources.forEach((source) => {
      const filePath = path.join(process.cwd(), HYPERMOD_DIR, id, source.name);
      if (filePath.includes("transform.js")) {
        transformPaths.push(filePath);
      }

      core.info(`Writing ${filePath}`);
      fs.outputFileSync(filePath, source.code);
    });
  });

  try {
    const { exitCode, stderr } = await getExecOutput(
      `npx --yes @hypermod/cli -t ${transformPaths.join(
        ","
      )} --parser tsx --extensions tsx,ts,js src/`
    );

    if (exitCode) {
      core.setFailed(`Error: transform failed with:  ${exitCode}`);
      core.error(stderr);
    }
  } catch (err) {}

  // Clean up temporary files
  await fs.remove(path.join(HYPERMOD_DIR));

  // TODO: perform formatting with script of choice via npm run hypermod:format

  // Check if there are any file diffs
  const diffs = await status();

  if (!Boolean(diffs.length)) {
    core.info("@hypermod: No changes detected\n");
    return;
  }

  core.info("@hypermod: Writing altered files to pull request\n");
  core.info(diffs);

  await commitAll(`@hypermod ${deployment.title}`);

  const octokit = setupOctokit(githubToken);
  const searchQuery = `repo:${repo}+state:open+head:${branchName}+base:${branch}+is:pull-request`;
  const searchResultPromise = octokit.rest.search.issuesAndPullRequests({
    q: searchQuery,
  });

  await push(branchName, { force: true });

  const searchResult = await searchResultPromise;
  core.info(JSON.stringify(searchResult.data, null, 2));

  let pullRequestNumber: number;

  if (searchResult.data.items.length === 0) {
    core.info("@hypermod: Creating pull request\n");
    const { data: newPullRequest } = await octokit.rest.pulls.create({
      base: branch,
      head: branchName,
      title: deployment.title,
      body: deployment.description,
      ...github.context.repo,
    });

    pullRequestNumber = newPullRequest.number;
  } else {
    const [pullRequest] = searchResult.data.items;

    core.info(`updating found pull request #${pullRequest.number}`);
    await octokit.rest.pulls.update({
      pull_number: pullRequest.number,
      title: deployment.title,
      body: deployment.description,
      ...github.context.repo,
    });

    pullRequestNumber = pullRequest.number;
  }

  await fetch(
    `https://hypermod.vercel.app/api/action/${deploymentId}/deployment/${repo}`,
    {
      method: "POST",
      body: JSON.stringify({ pullRequestNumber }),
      headers: { "Content-Type": "application/json" },
    }
  );

  core.setOutput("pullRequestNumber", String(pullRequestNumber));
})().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
