import { describe, it, expect } from "vitest";
import { resolveAction } from "./actions";
import { Action, Argument } from "./types";

describe("resolveAction", () => {
  it("should generate the correct command for install-dependency", () => {
    const action: Action = { name: "install-dependency" };
    const args: Argument[] = [
      { key: "dependency-name", value: "lodash" },
      { key: "version", value: "4.17.21" },
    ];
    const result = resolveAction(action, args);
    expect(result).toBe("ni lodash@4.17.21");
  });

  it("should generate the correct command for remove-dependency", () => {
    const action: Action = { name: "remove-dependency" };
    const args: Argument[] = [{ key: "dependency-name", value: "lodash" }];
    const result = resolveAction(action, args);
    expect(result).toBe("nun lodash");
  });

  it("should generate the correct command for file-delete", () => {
    const action: Action = { name: "file-delete" };
    const args: Argument[] = [{ key: "file-path", value: "/tmp/test.txt" }];
    const result = resolveAction(action, args);
    expect(result).toBe("rm /tmp/test.txt");
  });

  it("should return an empty string for unknown actions", () => {
    // @ts-expect-error
    const action: Action = { name: "unknown-action" };
    const args: Argument[] = [];
    const result = resolveAction(action, args);
    expect(result).toBe("");
  });
});
