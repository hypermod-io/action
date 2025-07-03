import { Action, Argument } from "./types";

export function resolveAction(
  action: Action,
  actionArguments: Argument[]
): string {
  const args = actionArguments.reduce<Record<string, string>>(
    (acc, arg) => ({ ...acc, [arg.key]: arg.value }),
    {}
  );

  switch (action.name) {
    case "install-dependency":
      return `ni ${args["dependency-name"]}${
        `@${args["version"]}` || ""
      }`.trim();
    case "remove-dependency":
      return `nun ${args["dependency-name"]}`;
    case "upgrade-dependency":
      return `nup ${args["dependency-name"]}${
        `@${args["version"]}` || ""
      }`.trim();
    case "file-delete":
      return `rm ${args["file-path"]}`;
    case "file-create":
      return `echo "${args["file-content"]}" > ${args["file-path"]}`;
    case "file-move":
      return `mv ${args["source-path"]} ${args["destination-path"]}`;
    case "folder-create":
      return `mkdir -p ${args["folder-path"]}`;
    case "folder-move":
      return `mv ${args["source-path"]} ${args["destination-path"]}`;
    case "folder-delete":
      return `rm -rf ${args["folder-path"]}`;
    default:
      console.error(`Unknown action: ${action.name}. Skipping...`);
  }
  return "";
}
