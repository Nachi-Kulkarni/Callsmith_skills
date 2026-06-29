## Summary
<!-- What does this PR change and why? -->

## Verification

- [ ] `npm test` passes (green)
- [ ] `node bin/callsmith.mjs verify-packs` reports 0 failures (if packs changed)
- [ ] `node bin/callsmith.mjs release-check --skip-tests --skip-generated-install` passes
- [ ] If generated runtime dependencies changed, `node bin/callsmith.mjs release-check --skip-tests --full-installs` passes
- [ ] If audio-contract resolution changed, a fixture exercises the change
- [ ] No new runtime dependencies (or justified below)

## Type
<!-- Check one: -->
- [ ] Provider pack (new or updated contract/model/pricing)
- [ ] Resolver / audio-contract fix
- [ ] Scaffold improvement
- [ ] CLI / UX
- [ ] Docs / OSS
