import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ApiBrain,
  CATALOG_CHARACTER_BUDGET,
  LocalBrain,
  createBrain,
  loadCredentialDocument,
  parseAndValidateProposal,
  runAskFlow,
  serializeCatalog,
  summarizeRecipes,
  type ApiProvider,
  type Brain,
  type BrainProposal,
  type FetchLike,
} from "../src/brain/index.js";
import { conductorConfigSchema } from "../src/mcp/config.js";
import {
  listRecipes,
  titleCardRecipe,
} from "../src/recipes/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const proposal: BrainProposal = {
  recipeId: "title-card",
  params: {
    text: "A clear opening title",
    outputPath: "/renders/opening-title.mov",
  },
  rationale:
    "A restrained title card directly matches the requested opening.",
};

const proposalJson = JSON.stringify(proposal);
const recipeSummaries = summarizeRecipes(listRecipes());
const suggestRequest = {
  userGoal: "Create a restrained opening title",
  recipes: recipeSummaries,
};

function providerEnvelope(
  provider: ApiProvider | "openai-compatible",
  text: string,
): unknown {
  if (provider === "anthropic") {
    return {
      content: [{ type: "text", text }],
    };
  }
  if (provider === "gemini") {
    return {
      candidates: [{ content: { parts: [{ text }] } }],
    };
  }
  return {
    choices: [{ message: { content: text } }],
  };
}

function responseFetch(
  provider: ApiProvider | "openai-compatible",
  responses: string[],
): {
  fetch: FetchLike;
  mock: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  const mock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) => {
      const text = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return new Response(
        JSON.stringify(providerEnvelope(provider, text ?? "")),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );
  return {
    fetch: mock as FetchLike,
    mock,
  };
}

function requestFrom(
  mock: ReturnType<typeof vi.fn>,
  index = 0,
): {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const call = mock.mock.calls[index];
  if (call === undefined) throw new Error(`Missing fetch call ${index}`);
  const url = String(call[0]);
  const init = call[1] as RequestInit;
  return {
    url,
    init,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    headers: init.headers as Record<string, string>,
  };
}

describe("brain proposal validation and retry", () => {
  it("accepts a catalog recipe with schema-valid parameters", () => {
    expect(
      parseAndValidateProposal(proposalJson, recipeSummaries),
    ).toEqual(proposal);
  });

  it("rejects unknown recipes and invalid recipe parameters", () => {
    expect(() =>
      parseAndValidateProposal(
        JSON.stringify({
          ...proposal,
          recipeId: "invented-recipe",
        }),
        recipeSummaries,
      ),
    ).toThrow(/unknown recipe/i);

    expect(() =>
      parseAndValidateProposal(
        JSON.stringify({
          ...proposal,
          params: { text: "Missing the required output path" },
        }),
        recipeSummaries,
      ),
    ).toThrow(/invalid parameters/i);
  });

  it("retries once with validation feedback and accepts the correction", async () => {
    const transport = responseFetch("openai", [
      "not JSON",
      proposalJson,
    ]);
    const brain = new ApiBrain({
      provider: "openai",
      model: "test-model",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "test-secret",
      fetch: transport.fetch,
    });

    await expect(brain.suggest(suggestRequest)).resolves.toEqual(proposal);
    expect(transport.mock).toHaveBeenCalledTimes(2);
    const retryBody = requestFrom(transport.mock, 1).body;
    expect(JSON.stringify(retryBody)).toContain(
      "Previous response validation error",
    );
  });

  it("fails cleanly after exactly one retry", async () => {
    const transport = responseFetch("openai", ["{}", "{}"]);
    const brain = new ApiBrain({
      provider: "openai",
      model: "test-model",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "test-secret",
      fetch: transport.fetch,
    });

    await expect(brain.suggest(suggestRequest)).rejects.toThrow(
      "invalid proposal after one retry",
    );
    expect(transport.mock).toHaveBeenCalledTimes(2);
  });

  it("budgets catalog summaries without exposing recipe steps", () => {
    const serialized = serializeCatalog(recipeSummaries);
    expect(serialized.length).toBeLessThanOrEqual(
      CATALOG_CHARACTER_BUDGET,
    );
    expect(serialized).not.toContain('"steps"');
    expect(serialized).not.toContain("queueRender");
    expect(serialized).not.toContain("setKeyframes");
  });
});

describe("provider request shaping", () => {
  const providerCases = [
    {
      provider: "openai" as const,
      endpoint: "https://api.openai.com/v1/chat/completions",
      keyHeader: "authorization",
      keyValue: "Bearer openai-test-secret",
      bodyProperties: ["messages", "response_format"],
    },
    {
      provider: "anthropic" as const,
      endpoint: "https://api.anthropic.com/v1/messages",
      keyHeader: "x-api-key",
      keyValue: "anthropic-test-secret",
      bodyProperties: ["system", "messages"],
    },
    {
      provider: "gemini" as const,
      endpoint:
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
      keyHeader: "x-goog-api-key",
      keyValue: "gemini-test-secret",
      bodyProperties: ["systemInstruction", "contents", "generationConfig"],
    },
  ];

  for (const testCase of providerCases) {
    it(`shapes ${testCase.provider} requests without logging or embedding the key`, async () => {
      const transport = responseFetch(testCase.provider, [proposalJson]);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const brain = new ApiBrain({
        provider: testCase.provider,
        model:
          testCase.provider === "gemini"
            ? "gemini-test"
            : "test-model",
        endpoint: testCase.endpoint,
        apiKey: testCase.keyValue.replace(/^Bearer /, ""),
        fetch: transport.fetch,
      });

      await expect(brain.suggest(suggestRequest)).resolves.toEqual(
        proposal,
      );

      const request = requestFrom(transport.mock);
      expect(request.url).toBe(testCase.endpoint);
      expect(request.init.method).toBe("POST");
      expect(request.headers[testCase.keyHeader]).toBe(testCase.keyValue);
      for (const property of testCase.bodyProperties) {
        expect(request.body).toHaveProperty(property);
      }
      expect(JSON.stringify(request.body)).not.toContain(
        testCase.keyValue.replace(/^Bearer /, ""),
      );
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  }

  it("uses the OpenAI-compatible shape for a local brain", async () => {
    const transport = responseFetch("openai-compatible", [proposalJson]);
    const brain = new LocalBrain({
      model: "qwen-test",
      baseUrl: "http://127.0.0.1:11434/v1/",
      fetch: transport.fetch,
    });

    await brain.suggest(suggestRequest);
    const request = requestFrom(transport.mock);
    expect(request.url).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
    expect(request.headers).not.toHaveProperty("authorization");
    expect(request.body).toMatchObject({
      model: "qwen-test",
      response_format: { type: "json_object" },
    });
  });

  it("health-checks the endpoint with GET and no project data", async () => {
    const mock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    const brain = new ApiBrain({
      provider: "anthropic",
      model: "test-model",
      endpoint: "https://api.anthropic.com/v1/messages",
      apiKey: "health-test-secret",
      fetch: mock as FetchLike,
    });

    await expect(brain.checkHealth()).resolves.toEqual({
      ok: true,
      message: "anthropic endpoint reachable",
    });
    const call = mock.mock.calls[0];
    expect(String(call?.[0])).toBe(
      "https://api.anthropic.com/v1/models",
    );
    expect(call?.[1]).toMatchObject({ method: "GET" });
    expect((call?.[1] as RequestInit).body).toBeUndefined();
  });

  it("does not expose a rejected endpoint response body", async () => {
    const mock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            error: "request rejected for leaked-test-secret",
          }),
          { status: 401 },
        ),
    );
    const brain = new ApiBrain({
      provider: "openai",
      model: "test-model",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "leaked-test-secret",
      fetch: mock as FetchLike,
    });

    let message = "";
    try {
      await brain.suggest(suggestRequest);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain("leaked-test-secret");
  });

  it("validates optional review notes", async () => {
    const transport = responseFetch("openai", [
      JSON.stringify({ note: "The deterministic run completed cleanly." }),
    ]);
    const brain = new ApiBrain({
      provider: "openai",
      model: "test-model",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "test-secret",
      fetch: transport.fetch,
    });

    await expect(
      brain.review({
        recipeId: "title-card",
        status: "completed",
        steps: [
          { id: "queue-verified-render", status: "succeeded", durationMs: 12 },
        ],
      }),
    ).resolves.toBe("The deterministic run completed cleanly.");
  });
});

describe("brain configuration and credential safety", () => {
  it("defaults omitted brain config to the none implementation", async () => {
    const config = conductorConfigSchema.parse({ servers: {} });
    const brain = await createBrain({
      config: config.brain,
      credentialsPath: "/a/path/that/must/not/be-read",
    });

    expect(brain.kind).toBe("none");
    expect(brain.capabilities).toEqual({
      suggest: false,
      review: false,
    });
    await expect(brain.checkHealth()).resolves.toMatchObject({ ok: true });
    await expect(brain.suggest(suggestRequest)).rejects.toThrow(
      /suggestions are disabled/i,
    );
  });

  it("rejects API keys in conductor.config.json-shaped data", () => {
    expect(
      conductorConfigSchema.safeParse({
        servers: {},
        brain: {
          type: "api",
          provider: "openai",
          model: "test-model",
          apiKey: "must-not-be-here",
        },
      }).success,
    ).toBe(false);
  });

  it("requires credentials.json to have POSIX mode 600", async () => {
    if (process.platform === "win32") return;

    const directory = await mkdtemp(join(tmpdir(), "conductor-brain-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "credentials.json");
    await writeFile(
      path,
      JSON.stringify({
        providers: {
          openai: {
            apiKey: "credential-test-secret",
            model: "test-model",
          },
        },
      }),
      { encoding: "utf8", mode: 0o644 },
    );
    await chmod(path, 0o644);

    await expect(loadCredentialDocument(path)).rejects.toThrow(/mode 600/);
    await chmod(path, 0o600);
    await expect(loadCredentialDocument(path)).resolves.toMatchObject({
      providers: {
        openai: {
          apiKey: "credential-test-secret",
        },
      },
    });
  });

  it("loads API credentials from the environment without journal-shaped output", async () => {
    const transport = responseFetch("openai", [proposalJson]);
    const directory = await mkdtemp(join(tmpdir(), "conductor-empty-creds-"));
    temporaryDirectories.push(directory);
    const brain = await createBrain({
      config: {
        type: "api",
        provider: "openai",
        model: "test-model",
      },
      env: { OPENAI_API_KEY: "environment-test-secret" },
      credentialsPath: join(directory, "missing.json"),
      fetch: transport.fetch,
    });

    expect(brain.provenance).toEqual({
      brainType: "api",
      model: "test-model",
      provider: "openai",
    });
    expect(JSON.stringify(brain.provenance)).not.toContain(
      "environment-test-secret",
    );
  });

  it("fails cleanly when an API provider key is absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "conductor-no-key-"));
    temporaryDirectories.push(directory);

    await expect(
      createBrain({
        config: {
          type: "api",
          provider: "anthropic",
          model: "test-model",
        },
        env: {},
        credentialsPath: join(directory, "missing.json"),
      }),
    ).rejects.toThrow(
      "API key for brain provider 'anthropic' is not configured",
    );
  });
});

describe("confirmation boundary", () => {
  function fakeBrain(): Brain {
    return {
      kind: "api",
      capabilities: { suggest: true, review: false },
      provenance: {
        brainType: "api",
        provider: "openai",
        model: "test-model",
      },
      suggest: async () => proposal,
      checkHealth: async () => ({ ok: true, message: "mock reachable" }),
    };
  }

  it("does not execute a proposal that the human declines", async () => {
    const execute = vi.fn(async () => ({ runId: "must-not-run" }));
    const result = await runAskFlow({
      userGoal: "Create a restrained opening title",
      brain: fakeBrain(),
      recipes: [titleCardRecipe],
      confirm: async () => false,
      execute,
    });

    expect(result.confirmed).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes only validated recipe params and non-secret provenance after confirmation", async () => {
    const execute = vi.fn(async () => ({ runId: "mock-run" }));
    const result = await runAskFlow({
      userGoal: "Create a restrained opening title",
      brain: fakeBrain(),
      recipes: [titleCardRecipe],
      confirm: async () => true,
      execute,
    });

    expect(result.confirmed).toBe(true);
    expect(execute).toHaveBeenCalledWith({
      recipe: titleCardRecipe,
      params: expect.objectContaining({
        text: "A clear opening title",
        outputPath: "/renders/opening-title.mov",
      }),
      provenance: {
        brainType: "api",
        model: "test-model",
        provider: "openai",
      },
    });
  });
});
