# Security Policy

## Supported versions

Only the latest `main` and the most recent tag receive security fixes.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Email the maintainer directly, or open a private security advisory on GitHub:
`Security` tab > `Report a vulnerability`.

Include:
- A description of the issue and its impact
- Steps to reproduce (a malicious `answers.json` is the most likely vector)
- The affected command (`forge`, `scaffold`, `docs`, `simulate`)

You will receive an acknowledgment within 72 hours.

## Attack surface

callsmith is a CLI that reads a local JSON file (`--answers`) and writes files to disk (`--out`). The realistic threat model:

- **Provider id injection**: untrusted provider ids flow into generated Python (docstrings, comments) and agent-facing markdown. callsmith validates ids at the `expandAnswers` boundary (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`) and strips control characters from echoed values. See `src/lib/resolver.mjs`.
- **Path traversal**: file writes are relative to `--out`. Provider ids are validated before use in filenames.
- **Overwrite**: as of v1.4, `forge`/`scaffold`/`docs`/`simulate` refuse to overwrite existing files unless `--force` is passed. This prevents clobbering a user's repo.

If you find a bypass of any of the above, report it via the private channel.
