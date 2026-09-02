$ErrorActionPreference = 'Stop'
$nodeDir = Join-Path $PSScriptRoot '.node'
$npm = Join-Path $nodeDir 'npm.cmd'

if (-not (Test-Path $npm)) {
  throw "Portable Node.js is missing. Expected $npm"
}

$env:Path = "$nodeDir;$env:Path"
& $npm run build
