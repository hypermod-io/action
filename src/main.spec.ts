import {
  afterEach,
  describe,
  it,
  expect,
  vi,
  beforeEach,
  MockInstance,
} from "vitest";

vi.mock("@actions/exec", () => ({
  exec: vi.fn().mockResolvedValue(0),
  getExecOutput: vi
    .fn()
    .mockResolvedValue({ exitCode: 0, stderr: "", stdout: "" }),
}));

// Mock dependencies
vi.mock("./git");

vi.mock("@actions/core", () => ({
  getInput: vi.fn().mockImplementation((name) => {
    if (name === "deploymentId") return "test-deployment-id";
    if (name === "deploymentKey") return "test-deployment-key";
    throw new Error("Unknown input: " + name);
  }),
  info: vi.fn(),
  error: vi.fn().mockImplementation((msg) => console.error(msg)),
  warning: vi.fn(),
  setFailed: vi.fn().mockImplementation((msg) => console.error(msg)),
  setOutput: vi.fn(),
}));

vi.mock("@actions/github", () => ({
  context: {
    repo: { owner: "test-owner", repo: "test-repo" },
    ref: "refs/heads/main",
    eventName: "push",
  },
}));

vi.mock("fs-extra", async (importOriginal) => {
  const actual = await importOriginal<Object>();
  return {
    ...actual,
    outputFileSync: vi.fn(),
    remove: vi.fn(),
    writeFile: vi.fn(),
  };
});

vi.mock("./octokit");

import * as fs from "fs-extra";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as git from "./git";
import * as octokit from "./octokit";
import { Deployment } from "./types";
import main from "./main";

const mockDeployment: Deployment = {
  id: "test-deployment-id",
  title: "Mock Deployment",
  description: "Test Description",
  transforms: [
    {
      // Transform on deployment
      deploymentId: "test-deployment-id",
      transformId: "transform1",
      actionId: undefined,
      action: undefined,
      type: "TRANSFORM",
      arguments: [],
      transform: {
        // Transform details
        id: "transform1",
        parser: "tsx",
        deploymentId: "transform1",
        transformId: "transform1",
        sources: [
          {
            id: "test-id-1",
            name: "transform.js",
            code: "console.log('test');",
          },
        ],
      },
    },
  ],
};

let fetchDeploymentDataMock: MockInstance;

describe("GitHub Action Workflow", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_TOKEN", "test-token");

    vi.mocked(git.setupUser).mockResolvedValue();
    vi.mocked(git.switchToMaybeExistingBranch).mockResolvedValue();
    vi.mocked(git.reset).mockResolvedValue(0);
    vi.mocked(git.commitAll).mockResolvedValue();
    vi.mocked(git.status).mockResolvedValue("test-file.js");
    vi.mocked(git.push).mockResolvedValue();

    vi.mocked(octokit.setupOctokit).mockReturnValue({
      rest: {
        search: {
          // @ts-expect-error
          issuesAndPullRequests: vi
            .fn()
            .mockResolvedValue({ data: { items: [] } }),
        },
        pulls: {
          // @ts-expect-error
          create: vi.fn().mockResolvedValue({ data: { number: 123 } }),
          // @ts-expect-error
          update: vi.fn().mockResolvedValue({}),
        },
      },
    });

    fetchDeploymentDataMock = vi
      .fn()
      // Mocking deployment data fetch
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockDeployment),
        })
      )
      // Mocking fetch to return a successful response with mock deployment data
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200 }));

    vi.stubGlobal("fetch", fetchDeploymentDataMock);
  });

  it("should fail if GITHUB_TOKEN is not provided", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");

    await main();

    expect(core.setFailed).toHaveBeenCalledWith(
      "Please add the GITHUB_TOKEN to the hypermod workflow file"
    );
  });

  it("should install dependencies correctly", async () => {
    await main();

    expect(exec.getExecOutput).toHaveBeenCalledWith("npm", [
      "install",
      "-g",
      "@antfu/ni",
    ]);
    expect(exec.getExecOutput).toHaveBeenCalledWith("ni", ["--frozen"]);
  });

  it("should handle deployment API call correctly", async () => {
    vi.stubGlobal("fetch", fetchDeploymentDataMock);

    await main();

    expect(fetchDeploymentDataMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://www.hypermod.io/api/action/test-deployment-id/test-deployment-key/deployment/test-owner/test-repo"
      )
    );
  });

  it("should write transform source files correctly", async () => {
    vi.stubGlobal("fetch", fetchDeploymentDataMock);

    await main();

    expect(fs.outputFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".hypermod/transform1/transform.js"),
      "console.log('test');"
    );
  });

  it("should formulate and execute the correct TRANSFORM cli commands", async () => {
    vi.mocked(exec.getExecOutput)
      // install ni
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" })
      // install deps
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" })
      // run transform
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout: "Transform executed",
      });

    await main();

    expect(exec.getExecOutput).toHaveBeenCalledTimes(4);
    expect(exec.getExecOutput).toHaveBeenCalledWith(
      expect.stringMatching(
        /^hypermod -t .*\/.hypermod\/transform1\/transform.js --parser tsx (\.\/|\.)$/i
      )
    );
  });

  it("should formulate and execute the correct ACTION cli commands", async () => {
    const actionDeployment: Deployment = {
      ...mockDeployment,
      transforms: [
        mockDeployment.transforms[0],
        {
          deploymentId: "test-deployment-id",
          type: "ACTION",
          actionId: "action1",
          action: { name: "install-dependency" },
          arguments: [
            { key: "dependency-name", value: "example-package" },
            { key: "version", value: "1.0.0" },
          ],
        },
      ],
    };

    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(actionDeployment),
      })
    );

    await main();

    expect(exec.getExecOutput).toHaveBeenCalledTimes(5);
    expect(exec.getExecOutput).toHaveBeenCalledWith(
      expect.stringMatching(
        /^hypermod -t .*\/.hypermod\/transform1\/transform.js --parser tsx (\.\/|\.)$/i
      )
    );
    expect(exec.getExecOutput).toHaveBeenCalledWith("ni example-package@1.0.0");
  });

  it("should exit early if no changes are detected", async () => {
    vi.mocked(git.status).mockResolvedValue("");

    await main();

    expect(core.info).toHaveBeenCalledWith("@hypermod: No changes detected\n");
  });

  it("should create a new pull request if none exists", async () => {
    const octokitMock = {
      rest: {
        search: {
          issuesAndPullRequests: vi
            .fn()
            .mockResolvedValue({ data: { items: [] } }),
        },
        pulls: {
          create: vi.fn().mockResolvedValue({ data: { number: 123 } }),
          update: vi.fn().mockResolvedValue({}),
        },
      },
    };

    // @ts-expect-error
    vi.mocked(octokit.setupOctokit).mockReturnValue(octokitMock);

    await main();

    expect(octokitMock.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Mock Deployment",
        body: "Test Description",
        base: "main",
        head: "hypermod-transform/test-deployment-id",
      })
    );
  });

  it("should update an existing pull request", async () => {
    const octokitMock = {
      rest: {
        search: {
          issuesAndPullRequests: vi.fn().mockResolvedValue({
            data: { items: [{ number: 444, title: "Existing PR" }] },
          }),
        },
        pulls: {
          create: vi.fn().mockImplementation(() => {
            throw new Error("Create should not be called");
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      },
    };

    // @ts-expect-error
    vi.mocked(octokit.setupOctokit).mockReturnValue(octokitMock);

    await main();

    expect(octokitMock.rest.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "test-owner",
        pull_number: 444,
        repo: "test-repo",
      })
    );
  });

  it("should clean up temporary files", async () => {
    await main();

    expect(fs.outputFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".hypermod/transform1/transform.js"),
      "console.log('test');"
    );

    expect(fs.remove).toHaveBeenCalledWith(
      expect.stringContaining(".hypermod")
    );
  });

  it("should fail if a transform command fails", async () => {
    vi.mocked(exec.getExecOutput)
      // install hypermod cli
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" })
      // install ni
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" })
      // install deps
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" })
      // run transform
      .mockResolvedValue({
        exitCode: 1,
        stderr: "Error occurred",
        stdout: "",
      });

    await main();

    expect(core.setFailed).toHaveBeenCalledWith(
      "Error: transform failed with:  1"
    );
    expect(core.error).toHaveBeenCalledWith("Error occurred");
  });
});
