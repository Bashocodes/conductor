# Optional proposal brains

Conductor brains are proposal-only helpers. They receive a plain-language goal
and a bounded catalog containing recipe IDs, descriptions, and parameter JSON
Schemas. A brain can select one registered recipe, fill its declared
parameters, and provide a short rationale. It never receives an MCP client,
adapter registry, engine instance, full step list, or execution capability.

`conductor run` does not load a brain. The default `none` brain preserves the
fully deterministic workflow:

```json
{
  "brain": {
    "type": "none"
  },
  "servers": {}
}
```

## Human-gated ask flow

```sh
conductor ask "Create a restrained opening title for a 4K sequence"
```

Conductor validates the returned JSON object, applies recipe defaults, prints
the proposal, and asks:

```text
Execute this deterministic recipe? [y/N]
```

Declining exits without constructing MCP clients. Confirming passes the chosen
registered recipe and validated parameters to the ordinary sequential engine.
`--yes` is available for trusted, already-human-approved workflows. It is not
an autonomous execution mode.

Every proposal response must be one JSON object:

```json
{
  "recipeId": "title-card",
  "params": {
    "text": "Opening title",
    "outputPath": "/renders/opening-title.mov"
  },
  "rationale": "A title card directly matches the requested opening."
}
```

Unknown recipes, undeclared fields, and invalid parameters fail validation. A
malformed response receives one correction attempt containing compact
validation feedback. A second malformed response produces a clean error and no
execution. The recipe catalog has a fixed 12,000-character budget (roughly a
small prompt-sized token budget) and never contains step lists or tool calls.

## Cloud API brain

Choose a provider and model in the machine-local
`conductor.config.json`. Never put a key in this file:

```json
{
  "brain": {
    "type": "api",
    "provider": "openai",
    "model": "YOUR_MODEL_NAME"
  },
  "servers": {}
}
```

Supported providers are `openai`, `anthropic`, and `gemini`. Conductor shapes
requests for each provider's native chat/content endpoint and validates the
assistant text itself. Provider or proxy endpoints can be overridden with the
brain `endpoint` property.

Keys are read from these environment variables:

| Provider | Environment variable |
| --- | --- |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Gemini | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |

The provider and model can also be overridden with
`CONDUCTOR_BRAIN_PROVIDER`, `CONDUCTOR_BRAIN_MODEL`, and
`CONDUCTOR_BRAIN_ENDPOINT`.

## Local OpenAI-compatible brain

Ollama, LM Studio, vLLM, Qwen deployments, and similar servers can use the
OpenAI-compatible local mode:

```json
{
  "brain": {
    "type": "local",
    "model": "YOUR_LOCAL_MODEL",
    "baseUrl": "http://127.0.0.1:11434/v1"
  },
  "servers": {}
}
```

The defaults are `http://127.0.0.1:11434/v1` plus the configured model. Override
them with `CONDUCTOR_LOCAL_BASE_URL` and `CONDUCTOR_LOCAL_MODEL`. A local server
that requires a token can use `CONDUCTOR_LOCAL_API_KEY`.

Cloud and local brains implement the same interface. Moving a heavy local model
off the Adobe workstation changes configuration, not recipe behavior.

## Credentials file

As an alternative to environment variables, create
`~/.conductor/credentials.json`:

```json
{
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "apiKey": "YOUR_KEY",
      "model": "YOUR_MODEL_NAME"
    },
    "anthropic": {
      "apiKey": "YOUR_KEY",
      "model": "YOUR_MODEL_NAME"
    },
    "gemini": {
      "apiKey": "YOUR_KEY",
      "model": "YOUR_MODEL_NAME"
    }
  },
  "local": {
    "model": "YOUR_LOCAL_MODEL",
    "baseUrl": "http://127.0.0.1:11434/v1"
  }
}
```

On macOS and Linux the file must be owner-only:

```sh
chmod 600 ~/.conductor/credentials.json
```

Conductor refuses other permission modes. The repository config schema rejects
key fields, local credential paths are ignored, request bodies never contain
keys, errors do not include response bodies, and journals record only
non-secret proposal provenance.

## Doctor

`conductor doctor` validates the brain configuration and key presence. For API
or local brains it makes a metadata-only `GET` request to the provider's models
endpoint. It sends no goal, recipe catalog, parameters, journal, or project
data. With the default mode it reports:

```text
✓ brain: none (disabled; deterministic mode)
```

Provider request formats follow the official
[OpenAI structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs),
[Anthropic Messages API](https://platform.claude.com/docs/en/api/messages), and
[Gemini API](https://ai.google.dev/api) documentation.
