param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9-]+$')]
    [string]$Agent,

    [Parameter(Mandatory = $true)]
    [string]$Task,

    [switch]$EAInvoked
)

if (-not $EAInvoked) {
    throw 'Agent session records require an explicit EA invocation.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$sessionsDir = Join-Path $repoRoot 'context-vault\ops\sessions'
if (-not (Test-Path -LiteralPath $sessionsDir)) {
    New-Item -ItemType Directory -Path $sessionsDir | Out-Null
}

$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$notePath = Join-Path $sessionsDir "$stamp-$Agent.md"
if (Test-Path -LiteralPath $notePath) {
    throw "Session note already exists: $notePath"
}

$safeTask = $Task.Replace('"', "'")
$body = @"
---
date: $(Get-Date -Format 'yyyy-MM-dd')
agent: $Agent
task: "$safeTask"
invoked_by: EA
status: complete
---

# Session: $Task

## Goal

## Evidence reviewed

## Work completed

## Decisions and durable learnings

## Verification

## Next step
"@

Set-Content -LiteralPath $notePath -Value $body -Encoding utf8
Write-Output $notePath
