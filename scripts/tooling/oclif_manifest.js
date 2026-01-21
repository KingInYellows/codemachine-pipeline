'use strict';

const { spawnSync } = require('node:child_process');

const skipValues = new Set(['1', 'true', 'yes']);
const skipManifest = skipValues.has(String(process.env.OCLIF_SKIP_MANIFEST).toLowerCase());

if (skipManifest) {
  process.stdout.write('Skipping oclif manifest generation.\n');
  process.exit(0);
}

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npxCommand, ['-y', 'oclif', 'manifest'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
  },
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
