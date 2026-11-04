# Paddock's subagent hook on Windows, where an agent runs hooks with cmd.exe and Git's
# sh isn't on PATH (Codex). Same as subagents.sh: puts each running subagent on the
# agent's own herdr-core terminal as a label, so the sidebar can list it.
#   SubagentStart  paddock.sub.<app>.<agent_id>={"app":...,"type":...,"at":...}
#   SubagentStop   removes it (StopFailure too: an API error can end it with only that)
#   SessionStart / SessionEnd  removes every paddock.sub.<app>.* label left over
# Registered with "async": true. It prints nothing and always exits 0. Outside a
# Herdr terminal (no HC_TERMINAL_ID) it does nothing.
param([string]$App = "claude")
$ErrorActionPreference = "SilentlyContinue"
try {
  $app = ($App -replace '[^a-z0-9-]', '')
  if ($app.Length -gt 16) { $app = $app.Substring(0, 16) }
  $term = $env:HC_TERMINAL_ID
  $hc = (Get-Command hc -ErrorAction SilentlyContinue).Source
  if (-not $app -or -not $term -or -not $hc) { exit 0 }

  $text = [Console]::In.ReadToEnd()
  $in = $text | ConvertFrom-Json
  if (-not $in) { exit 0 }
  # Ids and types are plain words; anything else is dropped rather than quoted.
  $id = ([string]$in.agent_id -replace '[^A-Za-z0-9_-]', '')
  if ($id.Length -gt 64) { $id = $id.Substring(0, 64) }
  $type = ([string]$in.agent_type -replace '[^A-Za-z0-9_:. -]', '')
  if ($type.Length -gt 48) { $type = $type.Substring(0, 48) }
  $key = "paddock.sub.$app.$id"

  switch ([string]$in.hook_event_name) {
    "SubagentStart" {
      if ($id) {
        $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $value = '{"app":"' + $app + '","type":"' + $type + '","at":' + $at + '}'
        # PowerShell 5 drops inner double quotes when passing arguments to a program: escape them.
        & $hc label $term ("$key=" + ($value -replace '"', '\"')) *> $null
      }
    }
    { $_ -in "SubagentStop", "StopFailure" } {
      if ($id) { & $hc label $term "$key=" *> $null }
    }
    { $_ -in "SessionStart", "SessionEnd" } {
      $labels = (& $hc get $term --json 2>$null | Out-String | ConvertFrom-Json).labels
      if ($labels) {
        foreach ($name in $labels.PSObject.Properties.Name) {
          if ($name -like "paddock.sub.$app.*") { & $hc label $term "$name=" *> $null }
        }
      }
    }
  }
} catch {}
exit 0
