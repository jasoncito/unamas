#!/bin/bash
# PreToolUse hook for Bash: refuses any command that names a secrets file (.env*, .dev.vars*), so Claude
# can't print them with cat/grep/source/etc. Tools like wrangler, expo or node --env-file still read
# them on their own, since the command line doesn't name them.
cmd=$(jq -r '.tool_input.command // ""')
if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_])\.env|\.dev\.vars'; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: "Blocked: the command names a secrets file (.env* or .dev.vars*). Project rule: Claude never reads them."}}'
fi
exit 0
