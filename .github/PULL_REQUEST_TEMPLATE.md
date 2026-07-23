## Outcome

Describe the user-visible result and why it belongs in Conductor.

## Evidence

- [ ] `pnpm verify`
- [ ] `gitleaks detect --source . --redact`
- [ ] Dry-run excerpt or snapshot included when recipe behavior changes
- [ ] Fake-server execution coverage included when runtime behavior changes

## Determinism and safety

- [ ] Identical recipe parameters still produce an identical plan
- [ ] No recipe callback, shell step, `eval`, or arbitrary executable code
- [ ] No credentials, personal paths, private media, brand assets, or client data
- [ ] No upstream MCP server code vendored or copied
- [ ] No Adobe or live network dependency added to CI
- [ ] Brain changes remain proposal-only and preserve human confirmation

## Recipe craft review

Complete when adding or changing a recipe:

- [ ] Step IDs describe intent
- [ ] Position and camera keyframes use explicit easing
- [ ] Moving layers enable motion blur
- [ ] Transitions have a visible motivation rather than a bare crossfade
- [ ] The final step explicitly exports and verifies the result
- [ ] Every parameter branch has been dry-run and tested

## Documentation

List documentation and changelog changes, or explain why none are needed.
