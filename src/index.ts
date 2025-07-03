import * as core from "@actions/core";

import main from "./main";

(async () => {
  await main();
  console.log("Hypermod action completed successfully.");
})().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
