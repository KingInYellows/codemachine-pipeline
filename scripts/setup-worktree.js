#!/usr/bin/env node

'use strict';

/* eslint-disable no-console -- CLI script, not browser code */

let fs;
let os;
let path;
let spawnSync;

const CERT_ASSET_NAMES = ['certs', '.cert', '.ssl'];
const RUNTIME_DIRECTORIES = [
  ['.codepipe', 'runs'],
  ['.codepipe', 'logs'],
  ['.codepipe', 'metrics'],
  ['.codepipe', 'telemetry'],
];

async function loadDependencies() {
  let fsModule;
  let osModule;
  let pathModule;
  let childProcessModule;

  try {
    [fsModule, osModule, pathModule, childProcessModule] = await Promise.all([
      import('node:fs'),
      import('node:os'),
      import('node:path'),
      import('node:child_process'),
    ]);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  fs = fsModule;
  os = osModule;
  path = pathModule;
  spawnSync = childProcessModule.spawnSync;
}

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

function readOptionValue(args, optionName) {
  const value = args.shift();
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a path value.`);
  }

  return value;
}

function setPathOption(options, key, value) {
  if (key === 'sharedDir') {
    options.sharedDir = value;
    return;
  }

  options.seedDir = value;
}

function parseArgs(argv) {
  const options = {
    sharedDir: undefined,
    seedDir: undefined,
    skipInstall: false,
    skipBuild: false,
    help: false,
  };

  const pathOptions = new Map([
    ['--shared-dir', 'sharedDir'],
    ['--seed-dir', 'seedDir'],
  ]);
  const booleanOptions = new Map([
    ['--skip-install', 'skipInstall'],
    ['--skip-build', 'skipBuild'],
    ['--help', 'help'],
    ['-h', 'help'],
  ]);

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    const pathOption = pathOptions.get(arg);
    const booleanOption = booleanOptions.get(arg);

    if (pathOption) {
      setPathOption(options, pathOption, readOptionValue(args, arg));
      continue;
    }

    if (booleanOption === 'skipInstall') {
      options.skipInstall = true;
      continue;
    }

    if (booleanOption === 'skipBuild') {
      options.skipBuild = true;
      continue;
    }

    if (booleanOption === 'help') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
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

function readPackageName(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof packageJson.name === 'string' && packageJson.name.length > 0
      ? packageJson.name
      : path.basename(repoRoot);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return path.basename(repoRoot);
    }

    throw new Error(
      `Failed to parse package.json at ${packageJsonPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function sanitizeRepoName(name) {
  const sanitized = name
    .replace(/^@/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error(`Invalid package name for worktree setup: "${name}"`);
  }

  return sanitized;
}

function ensureDirectory(directoryPath, mode) {
  fs.mkdirSync(directoryPath, { recursive: true, mode });
}

function pathExists(entryPath) {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
}

function isDirectory(entryPath) {
  try {
    return fs.statSync(entryPath).isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
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
  const isDir = isDirectory(sourcePath);
  if (process.platform === 'win32' && !isDir) {
    fs.copyFileSync(sourcePath, destinationPath);
    return;
  }
  const linkType = process.platform === 'win32' && isDir ? 'junction' : undefined;
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
    '# Put real local secrets in your shared worktree asset directory.',
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
    ensureDirectory(path.join(repoRoot, ...relativeDir), 0o700);
  }
  info('Ensured .codepipe runtime directories');
}

function readNodeVersionMarker(sourcePath) {
  const sourceRoot = path.dirname(sourcePath);
  for (const markerName of ['.node-version', '.nvmrc']) {
    const markerPath = path.join(sourceRoot, markerName);
    if (pathExists(markerPath)) {
      return fs.readFileSync(markerPath, 'utf8').trim();
    }
  }

  return undefined;
}

function parseNodeMajor(version) {
  const match = version.match(/^v?(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function installDependencies(repoRoot) {
  const hasLockfile = pathExists(path.join(repoRoot, 'package-lock.json'));
  runCommand(
    repoRoot,
    'npm',
    hasLockfile ? ['ci', '--ignore-scripts'] : ['install', '--ignore-scripts']
  );
}

function installOrSkip(repoRoot, skipInstall) {
  if (skipInstall) {
    info('node_modules missing and install skipped');
    return;
  }

  installDependencies(repoRoot);
}

function tryLinkSharedNodeModules(repoRoot, sourcePath, skipInstall) {
  const sourceNodeVersion = readNodeVersionMarker(sourcePath);
  const sourceMajor = sourceNodeVersion ? parseNodeMajor(sourceNodeVersion) : undefined;
  const currentMajor = parseNodeMajor(process.version);

  if (!sourceNodeVersion) {
    info('Shared node_modules have no .node-version or .nvmrc marker; refusing to link them.');
    installOrSkip(repoRoot, skipInstall);
    return true;
  }

  if (sourceMajor === undefined || currentMajor === undefined) {
    info(
      `Could not parse shared Node marker "${sourceNodeVersion}" or current Node "${process.version}"; refusing to link shared node_modules.`
    );
    installOrSkip(repoRoot, skipInstall);
    return true;
  }

  if (sourceMajor !== currentMajor) {
    info(
      `Shared node_modules were prepared for Node ${sourceNodeVersion}; current Node is ${process.version}.`
    );
    installOrSkip(repoRoot, skipInstall);
    return true;
  }

  info(
    `Linking node_modules from ${sourcePath}; native modules may be incompatible if Node versions differ.`
  );
  return false;
}

function ensureNodeModules(repoRoot, repoAssetRoot, seedDir, skipInstall) {
  const destinationPath = path.join(repoRoot, 'node_modules');
  if (pathExists(destinationPath)) {
    info('Keeping existing node_modules');
    return;
  }

  const sourcePath = resolveLinkSource(repoAssetRoot, seedDir, 'node_modules');
  if (sourcePath) {
    if (tryLinkSharedNodeModules(repoRoot, sourcePath, skipInstall)) {
      return;
    }

    createSymlink(sourcePath, destinationPath);
    info('Linked node_modules');
    return;
  }

  installOrSkip(repoRoot, skipInstall);
}

function ensureBuild(repoRoot, skipBuild) {
  if (skipBuild) {
    info('Build skipped');
    return;
  }

  runCommand(repoRoot, 'npm', ['run', 'build']);
}

function runCommand(repoRoot, command, args) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  info(`Running ${[command, ...args].join(' ')}`);
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    fail(`Failed to spawn ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Command failed with exit code ${result.status}: ${[command, ...args].join(' ')}`);
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      printHelp();
      return;
    }

    const repoRoot = path.resolve(__dirname, '..');
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
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

loadDependencies()
  .then(main)
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
