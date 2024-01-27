import path from "path";
import fs from "fs-extra";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec, getExecOutput } from "@actions/exec";
import { throttling } from "@octokit/plugin-throttling";
import { GitHub, getOctokitOptions } from "@actions/github/lib/utils";

import {
  switchToMaybeExistingBranch,
  reset,
  checkIfClean,
  commitAll,
  setupUser,
  push,
  status,
} from "./git";

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
const HYPERMOD_DIR = path.join(process.cwd(), ".hypermod");

const setupOctokit = (githubToken: string) => {
  return new (GitHub.plugin(throttling))(
    getOctokitOptions(githubToken, {
      throttle: {
        onRateLimit: (
          retryAfter: number,
          options: { method: string; url: string },
          _octokit: any,
          retryCount: number
        ) => {
          core.warning(
            `Request quota exhausted for request ${options.method} ${options.url}`
          );

          if (retryCount <= 2) {
            core.info(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onSecondaryRateLimit: (
          retryAfter: number,
          options: { method: string; url: string },
          _octokit: any,
          retryCount: number
        ) => {
          core.warning(
            `SecondaryRateLimit detected for request ${options.method} ${options.url}`
          );

          if (retryCount <= 2) {
            core.info(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
      },
    })
  );
};

async function generatePr({
  commitMessage,
  finalPrTitle,
  prBody,
}: {
  commitMessage: string;
  finalPrTitle: string;
  prBody: string;
}) {
  const repo = `${github.context.repo.owner}/${github.context.repo.repo}`;
  const branch = github.context.ref.replace("refs/heads/", "");
  const transformBranch = `hypermod-transform/hello`;

  await switchToMaybeExistingBranch(transformBranch);
  await reset(github.context.sha);
  await commitAll(commitMessage);

  const octokit = setupOctokit(githubToken);
  const searchQuery = `repo:${repo}+state:open+head:${transformBranch}+base:${branch}+is:pull-request`;
  const searchResultPromise = octokit.rest.search.issuesAndPullRequests({
    q: searchQuery,
  });

  await push(transformBranch, { force: true });

  const searchResult = await searchResultPromise;
  core.info(JSON.stringify(searchResult.data, null, 2));

  if (searchResult.data.items.length === 0) {
    core.info("creating pull request");
    const { data: newPullRequest } = await octokit.rest.pulls.create({
      base: branch,
      head: transformBranch,
      title: finalPrTitle,
      body: prBody,
      ...github.context.repo,
    });

    return newPullRequest.number;
  } else {
    const [pullRequest] = searchResult.data.items;

    core.info(`updating found pull request #${pullRequest.number}`);
    await octokit.rest.pulls.update({
      pull_number: pullRequest.number,
      title: finalPrTitle,
      body: prBody,
      ...github.context.repo,
    });

    return pullRequest.number;
  }
}

(async () => {
  if (!githubToken) {
    core.setFailed("Please add the GITHUB_TOKEN to the hypermod workflow file");
    return;
  }

  core.info("Setting git user");
  await setupUser();

  await fs.writeFile(
    `${process.env.HOME}/.netrc`,
    `machine github.com\nlogin github-actions[bot]\npassword ${githubToken}`
  );

  const deploymentId = core.getInput("deploymentId");

  core.info(`Fetching and running provided deployment: ${deploymentId}`);

  const deployment: Deployment = await fetch(
    `https://hypermod.vercel.app/api/action/${deploymentId}/deployment`
  ).then((res) => res.json());

  core.info(
    `Fetching transform source files: ${Object.keys(deployment.transforms).join(
      ","
    )}`
  );

  const transformPaths: string[] = [];

  Object.entries(deployment.transforms).map(([id, sources]) => {
    sources.map((source) => {
      const filePath = path.join(HYPERMOD_DIR, id, source.name);
      core.info(`writing ${filePath}`);
      transformPaths.push(filePath);
      fs.writeFileSync(filePath, source.code);
    });
  });

  const { exitCode, stdout, stderr } = await getExecOutput(
    "npx @hypermod/cli",
    [`-t=${transformPaths.join(",")}`, "./src"]
  );

  if (exitCode) {
    core.setFailed(`Error: transform failed with:  ${exitCode}`);
    core.error(stderr);
    return;
  }

  if (stderr) {
    core.setFailed(`Error: ${stderr}`);
    return;
  }

  core.info(stdout);

  // Clean up temporary files
  await fs.remove(HYPERMOD_DIR);

  // TODO: perform formatting with script of choice via npm run hypermod:format

  // Check if there are any file diffs
  if (!(await checkIfClean())) {
    core.info("No changes detected");
    return;
  }

  core.info("Writing following altered files to pullrequest");
  const diffs = await status();
  core.info(diffs);

  // Generate pull requests
  const pullRequestNumber = await generatePr({
    finalPrTitle: deployment.title,
    prBody: deployment.description,
    commitMessage: `@hypermod ${deployment.title}`,
  });

  await fetch(
    `https://hypermod.vercel.app/api/action/${deploymentId}/deployment`,
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
