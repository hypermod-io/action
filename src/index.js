const core = require("@actions/core");
const { exec, getExecOutput } = require("@actions/exec");

const gitUtils = require("./git");

function generatePr({ branch }) {
  const repo = `${github.context.repo.owner}/${github.context.repo.repo}`;
  const branch = github.context.ref.replace("refs/heads/", "");
  const transformBranch = `hypermod-transform/hello`;

  await gitUtils.switchToMaybeExistingBranch(transformBranch);
  await gitUtils.reset(github.context.sha);

  return '1';
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
  const pullRequestNumber = generatePR({ branch: 'main' });

  // Check if there are any file diffs

  // If no diffs, exit
  if (false) {
    core.info("No changes detected");
    return;
  }

  // If so, generate pull requests
  if () {
    core.setOutput("pullRequestNumber", String(pullRequestNumber));
    return
  }

})().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
