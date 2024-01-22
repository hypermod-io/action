const core = require("@actions/core");
const { exec } = require("child_process");

(async () => {
    const { transformIds, directories } = JSON.parse(core.getInput("data"));

    core.info("Fetching and running provided transforms", transformIds, directories);
    exec(
      `npx @hypermod/cli -t ${transformIds} ${directories}`,
      (error, stdout, stderr) => {
        if (error) {
          core.setFailed(`Error: ${error.message}`);
          return;
        }
        if (stderr) {
          core.setFailed(`Error: ${stderr}`);
          return;
        }
        core.setOutput("result", stdout);
      }
    );
})().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
