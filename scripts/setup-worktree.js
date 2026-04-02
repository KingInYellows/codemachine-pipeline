#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CERT_ASSET_NAMES = ['certs', '.cert', '.ssl'];
const RUNTIME_DIRECTORIES = [
  path.join('.codepipe', 'runs'),
  path.join('.codepipe', 'logs'),
  path.join('.codepipe', 'metrics'),
  path.join('.codepipe', 'telemetry'),
];

function printHelp() {
  console.log(`Usage: node scripts/setup-worktree.js [options]

Configure a Codex App worktree without reading or printing secrets.

Options:
  --shared-dir <path>   Override the secure local asset directory
  --seed-dir <path>     Existing checkout to link ignored files from if the shared dir is empty
  --skip-install        Do not install npm dependencies when node_modules is missing
  --skip-build          Do not run npm run build after setup
  --help                Show this help text
`);
}

function parseArgs(argv) {
  const options = {
    sharedDir: undefined,
    seedDir: undefined,
    skipInstall: false,
    skipBuild: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--shared-dir':
        if (argv[index + 1] === undefined) {
          throw new Error('--shared-dir requires a path value.');
        }
        options.sharedDir = argv[index + 1];
        index += 1;
        break;
      case '--seed-dir':
        if (argv[index + 1] === undefined) {
          throw new Error('--seed-dir requires a path value.');
        }
        options.seedDir = argv[index + 1];
        index += 1;
        break;
      case '--skip-install':
        options.skipInstall = true;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.sharedDir === undefined && process.env.CODEX_WORKTREE_SHARED_DIR) {
    options.sharedDir = process.env.CODEX_WORKTREE_SHARED_DIR;
  }

  if (options.seedDir === undefined && process.env.CODEX_WORKTREE_SEED_DIR) {
    options.seedDir = process.env.CODEX_WORKTREE_SEED_DIR;
  }

  return options;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`- ${message}`);
}

function defaultSharedDir() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      return path.join(localAppData, 'CodeMachinePipeline', 'worktree-assets');
    }
  }

  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return path.join(xdgDataHome, 'codemachine-pipeline', 'worktree-assets');
  }

  return path.join(os.homedir(), '.local', 'share', 'codemachine-pipeline', 'worktree-assets');
}

function findRepoRoot(startDir) {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error('Could not find a package.json while walking upward from the current directory.');
    }

    currentDir = parentDir;
  }
}

function readPackageName(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return typeof packageJson.name === 'string' && packageJson.name.length > 0
    ? packageJson.name
    : path.basename(repoRoot);
}

function sanitizeRepoName(name) {
  return name.replace(/^@/, '').replace(/[\\/]/g, '__');
}

function ensureDirectory(directoryPath, mode) {
  fs.mkdirSync(directoryPath, { recursive: true, mode });
}

function pathExists(entryPath) {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(entryPath) {
  try {
    return fs.lstatSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveLinkSource(sharedRoot, seedDir, assetName) {
  const sharedCandidate = path.join(sharedRoot, assetName);
  if (pathExists(sharedCandidate)) {
    return sharedCandidate;
  }

  if (!seedDir) {
    return undefined;
  }

  const seedCandidate = path.join(seedDir, assetName);
  if (pathExists(seedCandidate)) {
    return seedCandidate;
  }

  return undefined;
}

function createSymlink(sourcePath, destinationPath) {
  const linkType =
    process.platform === 'win32' && isDirectory(sourcePath) ? 'junction' : undefined;
  fs.symlinkSync(sourcePath, destinationPath, linkType);
}

function writeFileIfMissing(filePath, content, mode) {
  if (pathExists(filePath)) {
    info(`Keeping existing ${path.relative(process.cwd(), filePath) || filePath}`);
    return;
  }

  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode });
  info(`Created ${path.relative(process.cwd(), filePath) || filePath}`);
}

function linkAssetIfAvailable(repoRoot, repoAssetRoot, seedDir, assetName) {
  const destinationPath = path.join(repoRoot, assetName);
  if (pathExists(destinationPath)) {
    info(`Keeping existing ${assetName}`);
    return;
  }

  const sourcePath = resolveLinkSource(repoAssetRoot, seedDir, assetName);
  if (!sourcePath) {
    info(`No shared ${assetName} found; skipping`);
    return;
  }

  createSymlink(sourcePath, destinationPath);
  info(`Linked ${assetName}`);
}

function ensureEnvFile(repoRoot, repoAssetRoot, seedDir) {
  const destinationPath = path.join(repoRoot, '.env');
  if (pathExists(destinationPath)) {
    info('Keeping existing .env');
    return;
  }

  const sourcePath = resolveLinkSource(repoAssetRoot, seedDir, '.env');
  if (sourcePath) {
    createSymlink(sourcePath, destinationPath);
    info('Linked .env');
    return;
  }

  const envStub = [
    '# Non-secret defaults for Codex App worktrees.',
    `# Put real local secrets in ${path.join(repoAssetRoot, '.env')}`,
    'NODE_ENV=development',
    'CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=3',
    'CODEPIPE_RUNTIME_TIMEOUT_MINUTES=30',
    '',
  ].join('\n');
  writeFileIfMissing(destinationPath, envStub, 0o600);
}

function ensureNpmrcFile(repoRoot, repoAssetRoot, seedDir) {
  const destinationPath = path.join(repoRoot, '.npmrc');
  if (pathExists(destinationPath)) {
    info('Keeping existing .npmrc');
    return;
  }

  const sourcePath = resolveLinkSource(repoAssetRoot, seedDir, '.npmrc');
  if (sourcePath) {
    createSymlink(sourcePath, destinationPath);
    info('Linked .npmrc');
    return;
  }

  const npmrcStub = [
    '@kinginyellows:registry=https://npm.pkg.github.com',
    'fund=false',
    'audit=false',
    '',
  ].join('\n');
  writeFileIfMissing(destinationPath, npmrcStub, 0o600);
}

function ensureRuntimeDirectories(repoRoot) {
  for (const relativeDir of RUNTIME_DIRECTORIES) {
    ensureDirectory(path.join(repoRoot, relativeDir), 0o700);
  }
  info('Ensured .codepipe runtime directories');
}

function ensureNodeModules(repoRoot, repoAssetRoot, seedDir, skipInstall) {
  const destinationPath = path.join(repoRoot, 'node_modules');
  if (pathExists(destinationPath)) {
    info('Keeping existing node_modules');
    return;
  }

  const sourcePath = resolveLinkSource(repoAssetRoot, seedDir, 'node_modules');
  if (sourcePath) {
    createSymlink(sourcePath, destinationPath);
    info('Linked node_modules');
    return;
  }

  if (skipInstall) {
    info('node_modules missing and install skipped');
    return;
  }

  runCommand(repoRoot, 'npm', ['install']);
}

function ensureBuild(repoRoot, skipBuild) {
  if (skipBuild) {
    info('Build skipped');
    return;
  }

  runCommand(repoRoot, 'npm', ['run', 'build']);
}

function runCommand(repoRoot, command, args) {
  info(`Running ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Failed to parse arguments.');
  }

  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const repoName = sanitizeRepoName(readPackageName(repoRoot));
  const sharedRoot = path.resolve(options.sharedDir ?? defaultSharedDir());
  const repoAssetRoot = path.join(sharedRoot, repoName);
  const seedDir = options.seedDir ? path.resolve(options.seedDir) : undefined;

  ensureDirectory(sharedRoot, 0o700);
  ensureDirectory(repoAssetRoot, 0o700);

  info(`Repo root: ${repoRoot}`);
  info(`Shared asset root: ${repoAssetRoot}`);
  if (seedDir) {
    info(`Seed checkout: ${seedDir}`);
  }

  ensureRuntimeDirectories(repoRoot);
  ensureEnvFile(repoRoot, repoAssetRoot, seedDir);
  ensureNpmrcFile(repoRoot, repoAssetRoot, seedDir);
  for (const assetName of CERT_ASSET_NAMES) {
    linkAssetIfAvailable(repoRoot, repoAssetRoot, seedDir, assetName);
  }
  ensureNodeModules(repoRoot, repoAssetRoot, seedDir, options.skipInstall);
  ensureBuild(repoRoot, options.skipBuild);

  info('Worktree setup complete');
}

main();
