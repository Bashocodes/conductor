# Changelog

All notable changes to Conductor are documented here. The project follows
[Semantic Versioning](https://semver.org/); alpha releases may still change
configuration and recipe contracts before `1.0.0`.

## [Unreleased]

No changes yet.

## [0.1.0-alpha.0] - 2026-07-23

### Phase 1 — deterministic foundation

- Added the strict TypeScript, ESM, Node 22, pnpm, Vitest, and CLI foundation.
- Added validated recipe data, parameter interpolation, safe preconditions,
  sequential execution, expected-shape verification, and JSON run journals.
- Added stdio and HTTP MCP client transports using the Model Context Protocol
  SDK.
- Added `recipes`, `run`, `run --dry-run`, and `doctor` CLI workflows.

### Phase 2 — craft recipes and adapters

- Added the portable ToolContract and declarative per-server adapter mapping.
- Added the generic After Effects and in-process fake-server adapters.
- Added `title-card`, `motivated-transition`, and `hdr-safe-grade` reference
  recipes.
- Encoded eased motion, motion blur, motivated transition timing, conservative
  technical grading, and verified render queue handoffs.

### Phase 3 — optional proposal brains

- Added permanent `none`, cloud `api`, and OpenAI-compatible `local` brain
  modes.
- Added OpenAI, Anthropic, Gemini, Ollama, LM Studio, vLLM, and similar endpoint
  request shaping.
- Added bounded recipe catalogs, schema-validated proposals, one corrective
  retry, confirmation gating, and non-secret journal provenance.
- Restricted credentials to environment variables or a mode-600 file outside
  the repository.

### Phase 4 — private OSS alpha readiness

- Added project governance, contribution, security, issue, and pull request
  documentation.
- Added Node 22 verification and gitleaks CI jobs.
- Added four scoped good-first-issue briefs.
- Documented ecosystem attribution, independence, safety, architecture, and
  the live-Adobe verification roadmap.

[Unreleased]: https://github.com/Bashocodes/conductor/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha.0]: https://github.com/Bashocodes/conductor/releases/tag/v0.1.0-alpha
