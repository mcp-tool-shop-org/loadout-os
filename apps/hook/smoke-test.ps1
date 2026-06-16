#requires -Version 5
<#
  Smoke test for the loadout hook.

  - Drift check (HOK-05): the LIVE hook (~/.claude/loadout-hook) must be byte-identical
    to the BUNDLE (apps/hook/dist/loadout-hook.mjs) — the dependency-free deployable
    that the coordinator copies to the live location. (The source loadout-hook.mjs is
    NOT the deployable: it `import`s @mcptoolshop/ai-loadout, which the live dir cannot
    resolve. The bundle inlines the kernel matcher.) The bundle is (re)built here first.
  - Threshold check (HOK-01): drives the hook with representative prompts and shows what
    it injects. The min-score floor (default 0.5 under the recall-aware scoring) means
    weak/incidental matches and off-topic prompts go silent.

  Isolation: runs the hook under a SCRATCH HOME (a copy of the live ~/.ai-loadout/index.json),
  so testing never appends to the live usage.jsonl.

  Usage:
    ./smoke-test.ps1                  # tests the BUNDLE (apps/hook/dist) by default
    ./smoke-test.ps1 -HookPath source # tests the SOURCE copy (needs the workspace node_modules)
    ./smoke-test.ps1 -HookPath live   # tests the LIVE copy (~/.claude/loadout-hook)
#>
param(
  [ValidateSet('bundle', 'source', 'live')]
  [string]$HookPath = 'bundle'
)
$ErrorActionPreference = 'Continue'

$source = Join-Path $PSScriptRoot 'loadout-hook.mjs'
$bundle = Join-Path $PSScriptRoot 'dist/loadout-hook.mjs'
$live   = Join-Path $HOME '.claude/loadout-hook/loadout-hook.mjs'

# ── (Re)build the bundle so the drift check compares against a fresh artifact ──
Write-Output ('=' * 78)
Write-Output 'BUILD — esbuild bundle (apps/hook/dist/loadout-hook.mjs)'
Write-Output ('=' * 78)
& node (Join-Path $PSScriptRoot 'esbuild.config.mjs')
if ($LASTEXITCODE -ne 0) { Write-Output "BUILD FAILED (esbuild exit $LASTEXITCODE)"; exit 1 }
Write-Output ''

# ── Drift check (HOK-05): live must equal the BUNDLE ────────────
Write-Output ('=' * 78)
Write-Output 'DRIFT CHECK — live vs bundle (must be byte-identical)'
Write-Output ('=' * 78)
$bundleHash = (Get-FileHash $bundle -Algorithm SHA256).Hash
if (Test-Path $live) {
  $liveHash = (Get-FileHash $live -Algorithm SHA256).Hash
  if ($bundleHash -eq $liveHash) { Write-Output "OK — identical ($bundleHash)" }
  else { Write-Output "DRIFT — bundle=$bundleHash  live=$liveHash" }
} else {
  Write-Output "live copy not found at $live"
}
Write-Output ''

# ── Resolve which hook to drive ─────────────────────────────────
$hook = switch ($HookPath) {
  'live'   { $live }
  'source' { $source }
  default  { $bundle }
}
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
