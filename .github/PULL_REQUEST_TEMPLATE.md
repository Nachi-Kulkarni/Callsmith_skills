## Summary
<!-- What does this PR change and why? -->

## Constitution check
- [ ] Aligns with [`product_decisions.md`](../product_decisions.md)
- [ ] Does **not** resurrect deleted generation (`forge` / `scaffold` / `init` / `simulate` / synthesis / lock-as-identity)
- [ ] New knowledge lands in packs, floors, skill/playbooks, or eval scenarios

## Verification

- [ ] `npm test` passes
- [ ] `node bin/callsmith.mjs pack validate` / `verify-packs` clean (if packs changed)
- [ ] `node bin/callsmith.mjs doctor` OK
- [ ] Contract/answers and turn-gap fixtures validate if behavior changed
- [ ] No new runtime dependencies (or justified below)

## Type
- [ ] Provider pack
- [ ] Physics / check / resolver
- [ ] Skill / playbooks / floors
- [ ] Eval harness / rubric / scenarios
- [ ] Docs / OSS
