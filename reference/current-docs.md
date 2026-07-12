# Current documentation policy

Provider packs are Callsmith's frozen, reviewable facts. They stop an agent from inventing voice
physics, but they are not a substitute for current SDK and API documentation during implementation.

## Source order

Use the first available source and record the exact library/version, URL or Context7 library ID, and
the lookup date in `YYYY-MM-DD` form in the handoff contract or build notes:

1. **Context7 MCP** — resolve the exact library, specify the version when known, then query only the
   API or configuration needed for the implementation.
2. **Context7 CLI + Skill** — if the client cannot load MCP servers, install with `npx ctx7 setup`,
   choose CLI + Skills mode, and use `ctx7 library` / `ctx7 docs`.
3. **Official provider documentation** — use any available web-fetch, browse, or URL-reading tool to
   read the provider's own versioned docs, API reference, changelog, or SDK repository. Prefer primary
   sources over tutorials, search snippets, and cached summaries.
4. **Stop** — if current primary documentation cannot be reached and the pack does not contain the
   required fact, mark it `UNVERIFIED` and ask for a source or refuse to ship that integration.

Context7 is optional infrastructure. Its absence must reduce convenience, not correctness.

## Freshness rule

Treat the current calendar date as part of the verification input. Before relying on an external
fact, compare today's date with the pack's evidence dates and `expires_at` value, when present.

Look the fact up again when any of these is true:

- the pack evidence is expired or has no usable date;
- the installed SDK/API version differs from the version named by the source;
- the provider has announced a migration, deprecation, beta, or surface change;
- the fact is volatile: model name, feature availability, pricing, rate limit, region, API shape,
  authentication, audio format, or interruption behavior;
- the user asks for the latest, current, newest, or recently supported behavior;
- there is a material conflict between model memory, the pack, and implementation code.

For volatile implementation facts, a source without a publication/update date is not automatically
current. Record the access date and corroborate it with the provider's changelog or versioned API
reference where practical. Never describe an undated or stale source as “latest.”

## What to verify

Before writing provider-specific implementation code, verify:

- installed SDK/package version and supported runtime;
- current constructor, session, streaming, and tool-call APIs;
- audio ingest and egress formats, rates, channels, and framing;
- interruption, cancellation, buffer flush, and hangup semantics;
- authentication/environment-key names;
- region, surface, and feature availability;
- deprecations or migrations affecting the chosen path.

Do not spend context loading whole documentation sets. Query the exact provider and exact decision.

## Pack conflict rule

Current primary documentation may reveal that a pack is stale. Do not silently override the pack in
one generated application. Instead:

1. cite the current primary source, its publication/update date when available, and access date;
2. identify the conflicting pack field;
3. mark the design blocked or explicitly unverified;
4. update and validate the provider pack in a reviewable change;
5. rerun `callsmith pack validate` and the relevant checks.

Policy floors and canonical answer IDs still come from Callsmith's versioned references. Context7
supplies current external API documentation; it does not define Callsmith policy or rewrite benchmark
oracles.

## Setup

The repository includes `.mcp.json` for clients that load project/plugin MCP configuration:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

For clients that do not load bundled MCP configuration:

```bash
npx ctx7 setup
```

The setup flow can install either MCP mode or CLI + Skills mode for the selected coding agent. A
Context7 API key is optional, but recommended for higher rate limits.

The bundled configuration uses stdio because it works in unattended/headless clients, including
Grok Build CLI. Context7's HTTP endpoint may advertise OAuth; Grok skips that server in non-interactive
mode unless an API key or stored OAuth token is configured. Users who prefer HTTP can run
`npx ctx7 setup` and authenticate, or configure `https://mcp.context7.com/mcp` with a
`CONTEXT7_API_KEY` header in their client.
