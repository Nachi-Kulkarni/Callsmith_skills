#!/usr/bin/env node
import { runReleaseCheck } from '../src/lib/release-check.mjs';

const args = new Set(process.argv.slice(2));
const report = runReleaseCheck({
  fullInstalls: args.has('--full-installs'),
  skipTests: args.has('--skip-tests'),
  skipGeneratedInstall: args.has('--skip-generated-install'),
  dryRun: args.has('--dry-run'),
  json: args.has('--json'),
});

if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
}

process.exit(report.status === 'FAIL' ? 1 : 0);
