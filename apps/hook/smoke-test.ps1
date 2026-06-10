$ErrorActionPreference = 'Continue'
$hook = 'C:/Users/mikey/.claude/loadout-hook/loadout-hook.mjs'

$prompts = @(
  @{ label = '1. GAME prompt (Star Freight visual canon)';
     payload = @{ prompt = 'I want to update the Star Freight visual canon — the Renna identity packet needs a new portrait variant. Open the right canon paths and the workflow profile.' } },
  @{ label = '2. TOOL prompt (shipcheck a repo before publish)';
     payload = @{ prompt = 'Run shipcheck audit on the role-os repo before npm publish — full treatment afterwards if it passes.' } },
  @{ label = '3. GENERIC prompt (mundane filesystem)';
     payload = @{ prompt = 'list the files in the current directory' } }
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
    Write-Output "(silent — no pointer injection)"
  } else {
    try {
      $parsed = $out | ConvertFrom-Json
      $ctx = $parsed.hookSpecificOutput.additionalContext
      Write-Output $ctx
    } catch {
      Write-Output "RAW OUTPUT: $out"
    }
  }
  Write-Output ""
  Write-Output ("latency: {0} ms" -f $ms)
  Write-Output ""
}
