import fs from "fs-extra";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec, getExecOutput } from "@actions/exec";
import { throttling } from "@octokit/plugin-throttling";
import { GitHub, getOctokitOptions } from "@actions/github/lib/utils";

const githubToken = process.env.GITHUB_TOKEN!;

import {
  switchToMaybeExistingBranch,
  reset,
  checkIfClean,
  commitAll,
  setupUser,
  push,
} from "./git";

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

  // project with `commit: true` setting could have already committed files
  if (!(await checkIfClean())) {
    await commitAll(commitMessage);
  }

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

  core.info("setting git user");
  await setupUser();

  await fs.writeFile(
    `${process.env.HOME}/.netrc`,
    `machine github.com\nlogin github-actions[bot]\npassword ${githubToken}`
  );

  const transformIds = core.getInput("transformIds");
  const directories = core.getInput("directories");

  core.info(
    `Fetching and running provided transforms: ${transformIds} on directories: ${directories}`
  );

  // const { exitCode, stdout, stderr } = await getExecOutput(
  //   "npx @hypermod/cli",
  //   [`-t=${transformIds}`, directories]
  // );

  // if (exitCode) {
  //   core.setFailed(`Error: ${error.message}`);
  //   return;
  // }

  // if (stderr) {
  //   core.setFailed(`Error: ${stderr}`);
  //   return;
  // }

  // core.info("stdout", stdout);

  // TODO: perform formatting with script of choice via npm run hypermod:format

  // Check if there are any file diffs

  // If no diffs, exit
  // if (false) {
  //   core.info("No changes detected");
  //   return;
  // }

  core.info("Writing changes to pullrequest");

  fs.writeFileSync("test.txt", "Hello world!" + Math.random());
  // If so, generate pull requests
  const pullRequestNumber = await generatePr({
    finalPrTitle: "test pr title",
    prBody: "test pr body",
    commitMessage: "test commit message",
  });
  core.setOutput("pullRequestNumber", String(pullRequestNumber));
})().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
