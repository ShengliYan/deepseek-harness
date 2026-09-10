param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedCommit,
  [ValidateRange(1,65535)][int]$Port = 3080
)
$ErrorActionPreference = 'Stop'
# 本轮只使用带盘符的 Windows 本地绝对路径；拒绝 C:relative 和相对路径。
if ($DataDirectory -notmatch '^[A-Za-z]:[\\/]') { throw 'DataDirectory must be an absolute local drive path' }
if ($NodeExecutable -notmatch '^[A-Za-z]:[\\/]') { throw 'NodeExecutable must be an absolute local drive path' }
if (-not (Test-Path -LiteralPath $DataDirectory -PathType Container)) { throw 'DataDirectory must exist' }
if (-not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) { throw 'NodeExecutable must exist' }
$nodeVersion = & $NodeExecutable -v
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v22.23.1') { throw 'Expected the verified Node v22.23.1' }
$env:PATH = (Split-Path -Parent $NodeExecutable) + ';' + $env:PATH
Set-Location -LiteralPath $PSScriptRoot
$actualCommit = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read checkout revision' }
if ($actualCommit -ne $ExpectedCommit) { throw 'Checkout differs from the tested candidate' }
$changes = @(git status --porcelain=v1)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect checkout status' }
if ($changes.Count -ne 0) { throw 'Checkout is not clean' }
$env:DSH_HOME = (Resolve-Path -LiteralPath $DataDirectory).Path
$entry = Join-Path $PSScriptRoot 'apps\cli\src\bin.ts'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'CLI entry is missing' }
& $NodeExecutable --import tsx/esm $entry web --port $Port --no-open
exit $LASTEXITCODE
