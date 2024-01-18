const core = require('@actions/core');
const { exec } = require('child_process');

async function run() {
  try {
    const eventType = core.getInput('eventType');
    if (eventType === 'CHECK') {
      // Handle CHECK event
      core.setOutput('result', 'Action is installed and operational.');
    } else if (eventType === 'TRANSFORM') {
      // Handle TRANSFORM event
      const transformId = core.getInput('transformId');
      const directories = core.getInput('directories');
      exec(`npx @hypermod/cli -t ${transformId} ${directories}`, (error, stdout, stderr) => {
        if (error) {
          core.setFailed(`Error: ${error.message}`);
          return;
        }
        if (stderr) {
          core.setFailed(`Error: ${stderr}`);
          return;
        }
        core.setOutput('result', stdout);
      });
    } else {
      core.setFailed('Invalid event type');
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}