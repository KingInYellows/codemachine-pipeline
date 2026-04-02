$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir 'setup-worktree.js') @args

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
