#requires -Version 5
<#
  Smoke test for the loadout hook.

  - Drift check (HOK-05): mirror (apps/hook) vs live (~/.claude/loadout-hook) must be byte-identical.
  - Threshold check (HOK-01): drives the hook with representative prompts and shows what it injects.
    A min-score floor means weak/incidental matches and off-topic prompts go silent.

  Isolation: runs the hook under a SCRATCH HOME (a copy of the live ~/.ai-loadout/index.json),
  so testing never appends to the live usage.jsonl.

  Usage:
    ./smoke-test.ps1                 # tests the MIRROR copy (this repo) by default
    ./smoke-test.ps1 -HookPath live  # tests the LIVE copy (~/.claude/loadout-hook)
#>
param(
  [string]$HookPath = 'mirror'
)
$ErrorActionPreference = 'Continue'

$mirror = Join-Path $PSScriptRoot 'loadout-hook.mjs'
$live   = Join-Path $HOME '.claude/loadout-hook/loadout-hook.mjs'

# ── Drift check (HOK-05) ────────────────────────────────────────
Write-Output ('=' * 78)
Write-Output 'DRIFT CHECK — mirror vs live (must be byte-identical)'
Write-Output ('=' * 78)
$mirrorHash = (Get-FileHash $mirror -Algorithm SHA256).Hash
if (Test-Path $live) {
  $liveHash = (Get-FileHash $live -Algorithm SHA256).Hash
  if ($mirrorHash -eq $liveHash) { Write-Output "OK — identical ($mirrorHash)" }
  else { Write-Output "DRIFT — mirror=$mirrorHash  live=$liveHash" }
} else {
  Write-Output "live copy not found at $live"
}
Write-Output ''

# ── Resolve which hook to drive ─────────────────────────────────
$hook = if ($HookPath -eq 'live') { $live } else { $mirror }
Write-Output "Driving: $hook"
Write-Output ''

# ── Scratch HOME (isolate from live usage.jsonl) ────────────────
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("loadout-smoke-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path (Join-Path $scratch '.ai-loadout') | Out-Null
$liveIndex = Join-Path $HOME '.ai-loadout/index.json'
if (Test-Path $liveIndex) {
  Copy-Item $liveIndex (Join-Path $scratch '.ai-loadout/index.json')
} else {
  Write-Output "WARN: no live index at $liveIndex — matching will be empty"
}

# Redirect the hook's homedir() (USERPROFILE on Windows) to the scratch dir so
# usage events land in scratch, never the live ~/.ai-loadout/usage.jsonl.
$origUserProfile = $env:USERPROFILE
$origHome        = $env:HOME
$env:USERPROFILE = $scratch
$env:HOME        = $scratch

$prompts = @(
  @{ label = '1. GAME prompt (Star Freight visual canon)';
     payload = @{ prompt = 'I want to update the Star Freight visual canon — the Renna identity packet needs a new portrait variant. Open the right canon paths and the workflow profile.' } },
  @{ label = '2. TOOL prompt (shipcheck a repo before publish)';
     payload = @{ prompt = 'Run shipcheck audit on the role-os repo before npm publish — full treatment afterwards if it passes.' } },
  @{ label = '3. GENERIC prompt (mundane filesystem)';
     payload = @{ prompt = 'list the files in the current directory' } },
  @{ label = '4. NOISE prompt (the known bad case — should be silent or strong-only)';
     payload = @{ prompt = "Let's build memory-os out using the dogfood swarm protocol." } },
  @{ label = '5. OFF-TOPIC prompt (should be silent)';
     payload = @{ prompt = 'what is the weather like today and should I bring an umbrella' } }
)

foreach ($p in $prompts) {
  Write-Output ('=' * 78)
  Write-Output $p.label
  Write-Output ('=' * 78)
  $body = $p.payload | ConvertTo-Json -Compress
  $start = [System.Diagnostics.Stopwatch]::StartNew()
  $out = $body | & node $hook 2>$null
  $start.Stop()
  $ms = $start.ElapsedMilliseconds
  if (-not $out -or $out.Trim().Length -eq 0) {
    Write-Output '(silent — no pointer injection)'
  } else {
    try {
      $parsed = $out | ConvertFrom-Json
      Write-Output $parsed.hookSpecificOutput.additionalContext
    } catch {
      Write-Output "RAW OUTPUT: $out"
    }
  }
  Write-Output ''
  Write-Output ("latency: {0} ms" -f $ms)
  Write-Output ''
}

# ── Restore env + cleanup scratch ───────────────────────────────
$env:USERPROFILE = $origUserProfile
$env:HOME        = $origHome
Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
