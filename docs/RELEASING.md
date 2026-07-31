# Releasing Callsmith

Callsmith releases the skill and optional verification CLI from the same tested commit. A release
does not imply provider-backed latency, capacity, cost, uptime, or real-user evidence unless the
release notes link to reviewed receipts for those claims.

## Before tagging

1. Move user-visible changes from `Unreleased` into the exact package version in `CHANGELOG.md`.
2. Synchronize `SKILL.md`, `providers/`, `reference/`, `examples/`, and `product_decisions.md` into
   the self-contained `skills/callsmith/` directory. Release integrity tests enforce byte parity.
3. Run:

   ```bash
   git diff --check
   npm test
   node bin/callsmith.mjs doctor
   node bin/callsmith.mjs pack validate
   node bin/callsmith.mjs verify-packs
   npm pack --dry-run --json
   ```

4. Install the exact tarball into a fresh prefix and run `doctor`, the clinic example `check`, and
   contract validation. `test/release-integrity.test.mjs` performs this journey in CI.
5. Merge to `main`, push, and wait for CI on the exact commit.

## Publish

Create an annotated `v<package-version>` tag only after the release commit passes. Push the tag and
create GitHub release notes from the matching changelog entry. GitHub's tag source archives are the
immutable downloadable release. Publish the npm package only when registry authentication and the
package name are confirmed; the universal skill install does not depend on npm publication.

The primary installation URL points at `main` for updates. The README also shows the tag-pinned URL
for reproducible installation and rollback.

## Roll back

Do not rewrite an existing tag. Fix forward with a patch version. Until the patch lands, users can
remove Callsmith with `npx skills remove callsmith` and install the previous tag-pinned skill URL.
If a release exposes sensitive evidence, remove the public asset, rotate affected credentials, and
publish a security advisory; never sanitize an already leaked secret in place and call it repaired.
