# Security policy

## Supported versions

Conductor is currently an alpha. Security fixes are applied only to the latest
commit on `main` and the newest prerelease tag.

| Version | Supported |
| --- | --- |
| `0.1.0-alpha.x` | Yes |
| Earlier snapshots | No |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or leaked credential.
Use a private GitHub Security Advisory:

<https://github.com/Bashocodes/conductor/security/advisories/new>

Include:

- the affected commit or tag;
- the attack or failure scenario;
- minimal reproduction steps;
- expected impact;
- any suggested mitigation;
- whether a credential or private project path may have been exposed.

You should receive an acknowledgement within three business days and an
initial assessment within seven business days. Timelines may change for an
unmaintained alpha, but reports will not be intentionally disclosed before a
fix or coordinated notice.

## Security boundaries

- Recipes are data and cannot contain shell steps, callbacks, or `eval`.
- The machine-owned config can name a stdio executable or an HTTP MCP endpoint;
  treat changes to that file as privileged.
- MCP servers control Adobe applications and may access project data. Install
  and review them separately; Conductor does not sandbox third-party servers.
- Brain credentials belong in environment variables or mode-600
  `~/.conductor/credentials.json`, never repository files.
- A brain produces proposals only. Human confirmation is required before the
  standard engine executes an `ask` proposal.
- Dry-run does not connect to a server.
- CI uses fake MCP implementations and must never receive Adobe credentials,
  media, or cloud brain keys.

If a secret is committed, revoke it first, then report the incident privately.
Rewriting Git history is not a substitute for credential rotation.
