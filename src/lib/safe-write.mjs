import fs from 'node:fs';
import path from 'node:path';

// Safe file writer with collision detection, --force, and --dry-run support.
// Every command that writes user-facing files (scaffold, forge, docs, simulate)
// routes through this so no existing file is silently overwritten.
//
// Policy:
//   force=false, dryRun=false (default): skip colliding files, record them in collisions[].
//   force=true: overwrite colliding files (still recorded in collisions[] for reporting).
//   dryRun=true: write nothing; populate manifest[] with what would be written.
export function createSafeWriter(root, opts = {}) {
  const { force = false, dryRun = false } = opts;
  const abs = path.resolve(root);
  const manifest = [];
  const collisions = [];
  const overwritten = [];

  function w(rel, content) {
    const full = path.join(abs, rel);
    const exists = fs.existsSync(full);
    if (exists) {
      if (force && !dryRun) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
        overwritten.push(rel);
        manifest.push(rel);
      } else {
        collisions.push(rel);
      }
      return;
    }
    if (dryRun) {
      manifest.push(rel);
      return;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    manifest.push(rel);
  }

  return {
    root: abs,
    force,
    dryRun,
    w,
    get manifest() { return [...manifest]; },
    get collisions() { return [...collisions]; },
    get overwritten() { return [...overwritten]; },
    get summary() {
      return {
        root: abs,
        written: dryRun ? 0 : manifest.length,
        wouldWrite: manifest.length,
        dryRun,
        collisions: [...collisions],
        overwritten: [...overwritten],
        manifest: [...manifest],
      };
    },
  };
}
