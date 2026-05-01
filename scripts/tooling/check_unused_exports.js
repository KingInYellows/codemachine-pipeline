#!/usr/bin/env node
'use strict';

/**
 * Unused export CI check.
 *
 * ts-unused-exports cannot distinguish public package barrels and dynamically
 * loaded oclif command modules from truly dead exports. This wrapper keeps the
 * raw checker useful by failing only on new entries outside the reviewed
 * baseline.
 */

async function main() {
  const [{ spawnSync }, fs, path] = await Promise.all([
    import('node:child_process'),
    import('node:fs'),
    import('node:path'),
  ]);
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = fs;
  const { dirname, isAbsolute, relative, resolve } = path;

  const root = resolve(__dirname, '..', '..');
  const baselinePath = resolve(root, 'config', 'unused-exports-baseline.json');
  const updateBaseline = process.argv.includes('--update-baseline');

  function normalizePath(filePath) {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(root, filePath);
    return relative(root, absolutePath).replace(/\\/g, '/');
  }

  function parseReport(output) {
    const entries = new Map();

    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^\d+ modules? with unused exports$/.test(line)) continue;

      const separator = line.indexOf(': ');
      if (separator === -1) continue;

      const filePath = normalizePath(line.slice(0, separator));
      const symbols = line
        .slice(separator + 2)
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      if (symbols.length > 0) {
        const existing = entries.get(filePath);
        entries.set(
          filePath,
          existing
            ? [...new Set([...existing, ...symbols])].sort((a, b) => a.localeCompare(b))
            : symbols
        );
      }
    }

    return entries;
  }

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function entriesToObject(entries) {
    return Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  function flatten(entries) {
    const flattened = new Set();
    for (const [filePath, symbols] of entries.entries()) {
      for (const symbol of symbols) {
        flattened.add(`${filePath}::${symbol}`);
      }
    }

    return flattened;
  }

  function loadBaseline() {
    if (!existsSync(baselinePath)) {
      console.error(`Missing unused export baseline: ${normalizePath(baselinePath)}`);
      console.error('Create it with: npm run exports:baseline');
      process.exit(2);
    }

    const rawBaseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    if (!isPlainObject(rawBaseline) || !isPlainObject(rawBaseline.entries)) {
      throw new Error(
        `Invalid baseline format: ${normalizePath(baselinePath)} entries must be an object of string arrays.`
      );
    }

    const baselineEntries = new Map();
    for (const [filePath, symbols] of Object.entries(rawBaseline.entries)) {
      if (!Array.isArray(symbols)) {
        throw new Error(
          `Invalid baseline format: ${normalizePath(baselinePath)} entry ${filePath} must be an array.`
        );
      }

      baselineEntries.set(
        filePath,
        [...symbols].map((symbol) => String(symbol)).sort((a, b) => a.localeCompare(b))
      );
    }

    return baselineEntries;
  }

  function countEntries(entries) {
    let count = 0;
    for (const symbols of entries.values()) count += symbols.length;
    return count;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['exec', '--', 'ts-unused-exports', 'tsconfig.json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    console.error(`Failed to run ts-unused-exports: ${result.error.message}`);
    process.exit(2);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (![0, 1].includes(result.status)) {
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 2);
  }

  const currentEntries = parseReport(result.stdout);
  const currentCount = countEntries(currentEntries);

  if (result.status === 1 && currentCount === 0) {
    process.stderr.write(result.stdout);
    console.error('ts-unused-exports exited with status 1 but produced no parseable report.');
    process.exit(2);
  }

  if (updateBaseline) {
    const baseline = {
      description:
        'Reviewed unused export baseline. The exports:check script fails only when ts-unused-exports reports entries outside this list.',
      generatedBy: 'npm run exports:baseline',
      entries: entriesToObject(currentEntries),
    };

    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Updated ${normalizePath(baselinePath)} with ${currentCount} unused export entries.`
    );
    process.exit(0);
  }

  const baselineEntries = loadBaseline();
  const baselineSet = flatten(baselineEntries);
  const currentSet = flatten(currentEntries);
  const newEntries = [...currentSet].filter((entry) => !baselineSet.has(entry)).sort();
  const resolvedEntries = [...baselineSet].filter((entry) => !currentSet.has(entry)).sort();

  console.log(`Unused exports: ${currentCount} found, ${baselineSet.size} in reviewed baseline.`);

  if (resolvedEntries.length > 0) {
    console.log(`Resolved baseline entries: ${resolvedEntries.length}.`);
    console.log('Run `npm run exports:baseline` after reviewing the diff to shrink the baseline.');
  }

  if (newEntries.length > 0) {
    console.error(`\nFound ${newEntries.length} new unused export(s):\n`);
    for (const entry of newEntries) {
      const [filePath, symbol] = entry.split('::');
      console.error(`  ${filePath}: ${symbol}`);
    }

    console.error(
      '\nRemove the unused exports, or run `npm run exports:baseline` only after reviewing intentional public/dynamic exports.'
    );
    process.exit(1);
  }

  console.log('No new unused exports introduced.');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
