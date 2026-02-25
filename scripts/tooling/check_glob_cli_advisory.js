#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const lockPath = path.join(repoRoot, 'package-lock.json');

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseVersion(value) {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(value || '');
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersion(a, b) {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1;
  }
  return 0;
}

function isVersionInRange(version, min, maxExclusive) {
  return compareVersion(version, min) >= 0 && compareVersion(version, maxExclusive) < 0;
}

function isVulnerableGlob(versionValue) {
  const version = parseVersion(versionValue);
  if (!version) {
    return false;
  }
  return Boolean(
    isVersionInRange(version, { major: 10, minor: 2, patch: 0 }, { major: 10, minor: 5, patch: 0 }) ||
    isVersionInRange(version, { major: 11, minor: 0, patch: 0 }, { major: 11, minor: 1, patch: 0 })
  );
}

function hasDependency(packageJson, name) {
  return Boolean(
    (packageJson.dependencies && packageJson.dependencies[name]) ||
      (packageJson.devDependencies && packageJson.devDependencies[name]) ||
      (packageJson.optionalDependencies && packageJson.optionalDependencies[name]) ||
      (packageJson.peerDependencies && packageJson.peerDependencies[name])
  );
}

function collectLockPackages(lockData) {
  const packages = lockData.packages || {};
  return Object.entries(packages);
}

function main() {
  const issues = [];
  const packageJson = readJson(packageJsonPath);
  const lockData = readJson(lockPath);

  if (hasDependency(packageJson, '@oclif/plugin-plugins')) {
    issues.push('package.json includes @oclif/plugin-plugins (remove to avoid glob CLI exposure).');
  }

  const lockPackages = collectLockPackages(lockData);
  const pluginEntries = lockPackages.filter(([key]) => 
    key === 'node_modules/@oclif/plugin-plugins' || key.endsWith('/node_modules/@oclif/plugin-plugins')
  );
  if (pluginEntries.length > 0) {
    issues.push('package-lock.json includes @oclif/plugin-plugins (remove from dependency tree).');
  }

  const globEntries = lockPackages.filter(([key, value]) => {
    if (!(key === 'node_modules/glob' || key.endsWith('/node_modules/glob'))) {
      return false;
    }
    return value && typeof value.version === 'string' && isVulnerableGlob(value.version);
  });

  if (globEntries.length > 0) {
    const versions = globEntries
      .map(([key, value]) => `${key}: ${value.version}`)
      .sort();
    issues.push(
      `Vulnerable glob CLI versions detected (GHSA-5j98-mcp5-4vw2):\n${versions.join('\n')}`
    );
  }

  if (issues.length > 0) {
    console.error('Security advisory guard failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log('Security advisory guard passed: no vulnerable glob CLI versions detected.');
}

main();
