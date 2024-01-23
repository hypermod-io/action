const { exec, getExecOutput } = require("@actions/exec");

export const setupUser = async () => {
  await exec("git", ["config", "user.name", `"github-actions[bot]"`]);
  await exec("git", [
    "config",
    "user.email",
    `"github-actions[bot]@users.noreply.github.com"`,
  ]);
};

export const pullBranch = async (branch) =>
  await exec("git", ["pull", "origin", branch]);

export const push = async (branch, { force } = {}) => {
  await exec(
    "git",
    ["push", "origin", `HEAD:${branch}`, force && "--force"].filter(Boolean)
  );
};

export const pushTags = async () =>
  await exec("git", ["push", "origin", "--tags"]);

export const switchToMaybeExistingBranch = async (branch) => {
  const { stderr } = await getExecOutput("git", ["checkout", branch], {
    ignoreReturnCode: true,
  });
  const isCreatingBranch = !stderr
    .toString()
    .includes(`Switched to a new branch '${branch}'`);
  if (isCreatingBranch) {
    await exec("git", ["checkout", "-b", branch]);
  }
};

export const reset = async (pathSpec, mode = "hard") =>
  await exec("git", ["reset", `--${mode}`, pathSpec]);

export const commitAll = async (message) => {
  await exec("git", ["add", "."]);
  await exec("git", ["commit", "-m", message]);
};

export const checkIfClean = async () => {
  const { stdout } = await getExecOutput("git", ["status", "--porcelain"]);
  return !stdout.length;
};
