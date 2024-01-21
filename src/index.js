const core = require("@actions/core");
const { exec } = require("child_process");

async function run() {
  try {
    const { transformIds, directories } = JSON.parse(core.getInput("data"));

    console.log("YO", transformIds, directories);
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
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}
