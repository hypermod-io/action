const fs = require("fs-extra");
const core = require("@actions/core");
const { exec, getExecOutput } = require("@actions/exec");
const { throttling } = require("@octokit/plugin-throttling");
const { GitHub, getOctokitOptions } = require("@actions/github/lib/utils");

const setupOctokit = (githubToken) => {
  return new (GitHub.plugin(throttling))(
    getOctokitOptions(githubToken, {
      throttle: {
        onRateLimit: (retryAfter, options, octokit, retryCount) => {
          core.warning(
            `Request quota exhausted for request ${options.method} ${options.url}`
          );

          if (retryCount <= 2) {
            core.info(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
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

async function generatePr() {
  const repo = `${github.context.repo.owner}/${github.context.repo.repo}`;
  const branch = github.context.ref.replace("refs/heads/", "");
  const transformBranch = `hypermod-transform/hello`;

  await switchToMaybeExistingBranch(transformBranch);
  await reset(github.context.sha);

  // project with `commit: true` setting could have already committed files
  if (!(await checkIfClean())) {
    const finalCommitMessage = `${commitMessage}${
      !!preState ? ` (${preState.tag})` : ""
    }`;
    await commitAll(finalCommitMessage);
  }

  const searchQuery = `repo:${repo}+state:open+head:${transformBranch}+base:${branch}+is:pull-request`;
  const searchResultPromise = octokit.rest.search.issuesAndPullRequests({
    q: searchQuery,
  });

  await push(transformBranch, { force: true });

  const searchResult = await searchResultPromise;
  core.info(JSON.stringify(searchResult.data, null, 2));

  const octokit = setupOctokit(githubToken);

  if (searchResult.data.items.length === 0) {
    core.info("creating pull request");
    const { data: newPullRequest } = await octokit.rest.pulls.create({
      base: branch,
      head: versionBranch,
      title: finalPrTitle,
      body: prBody,
      ...github.context.repo,
    });

    return {
      pullRequestNumber: newPullRequest.number,
    };
  } else {
    const [pullRequest] = searchResult.data.items;

    core.info(`updating found pull request #${pullRequest.number}`);
    await octokit.rest.pulls.update({
      pull_number: pullRequest.number,
      title: finalPrTitle,
      body: prBody,
      ...github.context.repo,
    });

    return {
      pullRequestNumber: pullRequest.number,
    };
  }

  return "1";
}

(async () => {
  const { transformIds, directories } = JSON.parse(core.getInput("data"));

  // TODO: check if this is necessary
  core.info("Setting GitHub credentials");

  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) {
    core.setFailed("Please add the GITHUB_TOKEN to the hypermod workflow file");
    return;
  }

  await fs.writeFile(
    `${process.env.HOME}/.netrc`,
    `machine github.com\nlogin github-actions[bot]\npassword ${githubToken}`
  );

  core.info(
    "Fetching and running provided transforms",
    transformIds,
    directories
  );

  const { exitCode, stdout, stderr } = await getExecOutput(
    "npx @hypermod/cli",
    [`t=${transformIds.join(",")}`, directories]
  );

  if (exitCode) {
    core.setFailed(`Error: ${error.message}`);
    return;
  }

  if (stderr) {
    core.setFailed(`Error: ${stderr}`);
    return;
  }

  core.info("stdout", stdout);
  // core.setOutput("result", stdout);

  // TODO: perform formatting with script of choice via npm run hypermod:format

  // Check if there are any file diffs

  // If no diffs, exit
  // if (false) {
  //   core.info("No changes detected");
  //   return;
  // }

  // // If so, generate pull requests
  // if () {
  //   const pullRequestNumber = await generatePr({  });
  //   core.setOutput("pullRequestNumber", String(pullRequestNumber));
  //   return
  // }
})().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
