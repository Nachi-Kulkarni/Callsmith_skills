# Security Policy

## Supported versions

Only the latest `main` and the most recent tag receive security fixes.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Email the maintainer directly, or open a private security advisory on GitHub:
`Security` tab > `Report a vulnerability`.

Include:

- A description of the issue and its impact
- Steps to reproduce (e.g. a malicious answers file, pack JSON, or contract path)
- Affected surface (`check`, `pack validate`, install script, skill docs)

You will receive an acknowledgment within 72 hours.

## Attack surface

callsmith is a thin verification CLI plus agent skill. Realistic threats:

- **Provider id injection** — untrusted ids in answers JSON. Validated at the expand boundary (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`) in `src/lib/resolver.mjs`. Control characters are stripped from echoed values.
- **Malicious packs** — community/user packs should be schema-validated before trust; treat unverified packs as untrusted data.
- **No generation write path** — scaffold/forge/simulate file writers were removed. The verification CLI does not overwrite user project trees.

If you find a bypass of id validation or a pack-load path that executes untrusted content, report it via the private channel.
