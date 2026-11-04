#!/bin/sh
# Paddock's Claude Code hook: puts each running subagent on the agent's own
# herdr-core terminal as a label, so the sidebar can list it under the agent.
#   SubagentStart  paddock.sub.claude.<agent_id>={"app":"claude","type":...,"at":...}
#   SubagentStop   removes it
#   SessionStart / SessionEnd  removes every paddock.sub.claude.* label left over
# Registered with "async": true, so Claude Code never waits for it. It prints
# nothing and always exits 0: it can't change what the agent does. Outside a
# Herdr terminal (no HC_TERMINAL_ID) it does nothing.

[ -n "$HC_TERMINAL_ID" ] || exit 0
command -v hc >/dev/null 2>&1 || exit 0

input=$(cat 2>/dev/null)
field() { printf '%s' "$input" | tr -d '\r\n' | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1; }

event=$(field hook_event_name)
# Ids and types are plain words; anything else is dropped rather than quoted.
id=$(field agent_id | tr -cd 'A-Za-z0-9_-' | cut -c1-64)
type=$(field agent_type | tr -cd 'A-Za-z0-9_:. -' | cut -c1-48)
key="paddock.sub.claude.$id"

case "$event" in
  SubagentStart)
    [ -n "$id" ] || exit 0
    hc label "$HC_TERMINAL_ID" "$key={\"app\":\"claude\",\"type\":\"$type\",\"at\":$(date +%s)000}" >/dev/null 2>&1
    ;;
  SubagentStop)
    [ -n "$id" ] || exit 0
    hc label "$HC_TERMINAL_ID" "$key=" >/dev/null 2>&1
    ;;
  SessionStart|SessionEnd)
    old=$(hc get "$HC_TERMINAL_ID" --json 2>/dev/null | grep -o '"paddock\.sub\.claude\.[A-Za-z0-9_-]*"' | tr -d '"' | sort -u)
    for k in $old; do hc label "$HC_TERMINAL_ID" "$k=" >/dev/null 2>&1; done
    ;;
esac
exit 0
