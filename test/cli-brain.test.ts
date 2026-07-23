import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brain } from "../src/brain/types.js";
import { createProgram } from "../src/cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function outputBuffer(): {
  stream: { write: (text: string | Uint8Array) => boolean };
  read: () => string;
} {
  let output = "";
  return {
    stream: {
      write: (text) => {
        output += String(text);
        return true;
      },
    },
    read: () => output,
  };
}

describe("CLI brain boundary", () => {
  it("keeps conductor run --dry-run brain-free with no config access", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const createBrain = vi.fn();

    await createProgram(
      { stdout: stdout.stream, stderr: stderr.stream },
      {
        createBrain,
        confirmExecution: async () => {
          throw new Error("Confirmation must not run");
        },
      },
    ).parseAsync([
      "node",
      "conductor",
      "--config",
      "/definitely/not/present/conductor.config.json",
      "run",
      "title-card",
      "--dry-run",
      "--param",
      "text=Brain-free title",
      "--param",
      "outputPath=/renders/brain-free.mov",
    ]);

    expect(createBrain).not.toHaveBeenCalled();
    expect(stderr.read()).toBe("");
    expect(stdout.read()).toMatchSnapshot();
  });

  it("prints a proposal but constructs no execution clients when confirmation is declined", async () => {
    const directory = await mkdtemp(join(tmpdir(), "conductor-cli-brain-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "conductor.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        servers: {},
        brain: {
          type: "api",
          provider: "openai",
          model: "mock-model",
        },
      }),
      "utf8",
    );
    const brain: Brain = {
      kind: "api",
      capabilities: { suggest: true, review: false },
      provenance: {
        brainType: "api",
        provider: "openai",
        model: "mock-model",
      },
      suggest: async () => ({
        recipeId: "title-card",
        params: {
          text: "Mocked proposal",
          outputPath: "/renders/mocked.mov",
        },
        rationale: "The goal asks for a concise title.",
      }),
      checkHealth: async () => ({ ok: true, message: "mock reachable" }),
    };
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const confirmExecution = vi.fn(async () => false);

    await createProgram(
      { stdout: stdout.stream, stderr: stderr.stream },
      {
        createBrain: async () => brain,
        confirmExecution,
      },
    ).parseAsync([
      "node",
      "conductor",
      "--config",
      configPath,
      "ask",
      "Make a concise title",
    ]);

    expect(confirmExecution).toHaveBeenCalledOnce();
    expect(stderr.read()).toBe("");
    expect(stdout.read()).toMatchSnapshot();
  });
});
