import path from "path";
import * as fs from "fs-extra";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec, getExecOutput } from "@actions/exec";

import {
  switchToMaybeExistingBranch,
  reset,
  commitAll,
  setupUser,
  push,
  status,
} from "./git";
import { setupOctokit } from "./octokit";
import { resolveAction } from "./actions";
import { Action, Deployment, Transform, TransformOnDeployment } from "./types";

const HYPERMOD_DIR = ".hypermod";

function isTransformEntry(
  entry: TransformOnDeployment
): entry is TransformOnDeployment & { transform: Transform } {
  return entry.type === "TRANSFORM" && entry.transform !== undefined;
}

function isActionEntry(
  entry: TransformOnDeployment
): entry is TransformOnDeployment & { action: Action } {
  return entry.type === "ACTION" && entry.action !== undefined;
}

export default async function main() {
  const githubToken = process.env.GITHUB_TOKEN!;

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

  // install @hypermod/cli globally
  core.info("@hypermod: Installing @hypermod/cli globally\n");
  const { exitCode: cliExitCode, stderr: cliStdErr } = await getExecOutput(
    "npm",
    ["install", "-g", "@hypermod/cli"]
  );

  // install ni globally
  core.info("@hypermod: Installing @antfu/ni globally\n");
  const { exitCode: niExitCode, stderr: niStdErr } = await getExecOutput(
    "npm",
    ["install", "-g", "@antfu/ni"]
  );

  if (niExitCode) {
    core.setFailed(`Error: npm install failed with: ${niExitCode}`);
    core.error(niStdErr);
    return;
  }

  // Install npm dependencies
  core.info("@hypermod: Installing dependencies\n");
  const { exitCode: installExitCode, stderr: installStderr } =
    await getExecOutput("ni", ["--frozen"]);

  if (installExitCode) {
    core.setFailed(`Error: npm install failed with: ${installExitCode}`);
    core.error(installStderr);
    return;
  }

  core.info("@hypermod: Preparing fresh branch\n");

  const deploymentId = core.getInput("deploymentId");
  const deploymentKey = core.getInput("deploymentKey");
  const repo = `${github.context.repo.owner}/${github.context.repo.repo}`;
  const branchName = `hypermod-transform/${deploymentId}`;
  const branch = github.context.ref.replace("refs/heads/", "");

  await switchToMaybeExistingBranch(branchName);
  await reset(github.context.sha);

  core.info(`Fetching and running provided deployment: ${deploymentId}`);

  const deploymentRes = await fetch(
    `https://www.hypermod.io/api/action/${deploymentId}/${deploymentKey}/deployment/${repo}`
  );

  if (!deploymentRes.ok) {
    core.setFailed(
      `Error: Deployment not found or invalid. Status: ${deploymentRes.status}`
    );
    return;
  }

  const deployment: Deployment = await deploymentRes.json();

  core.info(
    `@hypermod: Fetching transform source files: ${Object.keys(
      deployment.transforms
    ).join(",")}`
  );

  const commands: string[] = [];

  // Write transform source files to the .hypermod directory
  deployment.transforms.filter(isTransformEntry).forEach(({ transform }) => {
    transform.sources.forEach((source) => {
      const filePath = path.join(
        process.cwd(),
        HYPERMOD_DIR,
        transform.id,
        source.name
      );

      core.info(`Writing ${filePath}`);

      fs.outputFileSync(filePath, source.code);
    });
  });

  // Prepare cli commands to run the transforms
  deployment.transforms.forEach((entry) => {
    // Handle actions
    if (isActionEntry(entry)) {
      const command = resolveAction(entry.action, entry.arguments);
      commands.push(command);
      return;
    }

    // Handle transforms
    if (isTransformEntry(entry)) {
      const transformEntry = entry.transform.sources.find(({ name }) => {
        const cleanName = name.split("/").pop();
        return cleanName === "transform.ts" || cleanName === "transform.js";
      });

      if (!transformEntry) {
        core.warning(
          `No transform file found for transform ${entry.transform.id}. Skipping...`
        );
        return;
      }

      const entryFilePath = path.join(
        process.cwd(),
        HYPERMOD_DIR,
        entry.transform.id,
        transformEntry.name
      );

      commands.push(
        `hypermod -t ${entryFilePath} --parser ${
          entry.transform.parser || "tsx"
        } ./`
      );

      return;
    }

    core.warning(`Unsupported transform type: ${entry.type}. Skipping...`);
  });

  for (const command of commands) {
    try {
      const { exitCode, stderr } = await getExecOutput(command);

      if (exitCode) {
        core.setFailed(`Error: transform failed with:  ${exitCode}`);
        core.error(stderr);
      }
    } catch (err) {}
  }

  // Clean up temporary files
  await fs.remove(path.join(HYPERMOD_DIR));

  // Check if there are any file diffs
  const diffs = await status();

  if (!Boolean(diffs.length)) {
    core.warning("@hypermod: No changes detected\n");
    return;
  }

  core.info("@hypermod: Writing altered files to pull request\n");
  core.info(diffs);

  await exec("bash", [
    "-c",
    `git status --porcelain | awk '{print substr($0, 4)}' | grep -E '\\.(ts|tsx|js|jsx)$' | xargs -r npx prettier --write`,
  ]);

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
    `https://www.hypermod.io/api/action/${deploymentId}/${deploymentKey}/deployment/${repo}`,
    {
      method: "POST",
      body: JSON.stringify({ pullRequestNumber }),
      headers: { "Content-Type": "application/json" },
    }
  );

  core.setOutput("pullRequestNumber", String(pullRequestNumber));
}
