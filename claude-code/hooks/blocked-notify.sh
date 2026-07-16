#!/usr/bin/env bash
# Notification hook shipped with the Call Me plugin.
#
# A CLAUDE.md rule like "call me when you need me" can't fire once a turn has
# ended — the model is asleep while the session waits for input. This hook is
# the harness-level safety net: when Claude Code emits a Notification event
# (waiting for input / permission prompt), it rings the paired phone from the
# session's own Call Me thread, so the spoken/written reply flows back into
# the blocked session through the channel.
#
# No setup needed beyond the plugin's user_number config. Opt out with
# CALLME_NO_BLOCKED_RING=1. Debounce (default 30 min per session) via
# CALLME_BLOCKED_RING_DEBOUNCE=<seconds>.
set -u

[ "${CALLME_NO_BLOCKED_RING:-0}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

API="${AIPHONE_API:-https://serdaroztetik.com/aiphone}"
STATE_DIR="${AIPHONE_STATE_DIR:-$HOME/.aiphone}"
DEBOUNCE="${CALLME_BLOCKED_RING_DEBOUNCE:-1800}"
CALL_TIMEOUT="${AIPHONE_TIMEOUT:-120}"

INPUT=$(cat)
MSG=$(printf '%s' "$INPUT" | jq -r '.message // "Claude is waiting for your input"')
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' | tr -cd 'A-Za-z0-9-')
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
PROJECT=$(basename "${CWD:-session}")

# Same identity derivation as channel.mjs/inbound.mjs: per Claude session,
# falling back to the per-project channel file.
SESSION_FILE=""
if [ -n "$SID" ] && [ -f "$STATE_DIR/claude-session-$SID.json" ]; then
  SESSION_FILE="$STATE_DIR/claude-session-$SID.json"
elif [ -n "$CWD" ]; then
  PROJECT_KEY=$(printf '%s' "$CWD" | sed 's/[^A-Za-z0-9]\{1,\}/-/g')
  [ -f "$STATE_DIR/claude-channel-$PROJECT_KEY.json" ] && \
    SESSION_FILE="$STATE_DIR/claude-channel-$PROJECT_KEY.json"
fi

# The human's number: plugin config env if the host provides it, else the
# session file the channel server wrote (userConfig is NOT interpolated for
# hooks — same limitation as monitors).
NUMBER="${CLAUDE_PLUGIN_OPTION_user_number:-${AIPHONE_USER_NUMBER:-}}"
if ! printf '%s' "$NUMBER" | grep -Eq '^[0-9]{10}$'; then
  [ -n "$SESSION_FILE" ] && NUMBER=$(jq -r '.userNumber // empty' "$SESSION_FILE" 2>/dev/null)
fi
if ! printf '%s' "$NUMBER" | grep -Eq '^[0-9]{10}$'; then
  NUMBER=$(ls -t "$STATE_DIR"/claude-session-*.json 2>/dev/null | head -5 | \
    xargs -I{} jq -r '.userNumber // empty' {} 2>/dev/null | grep -E '^[0-9]{10}$' | head -1)
fi
printf '%s' "$NUMBER" | grep -Eq '^[0-9]{10}$' || exit 0

# Debounce per session so a long wait produces one ring, not a barrage.
STAMP_DIR="$STATE_DIR/hook-stamps"
mkdir -p "$STAMP_DIR" 2>/dev/null || exit 0
STAMP="$STAMP_DIR/${SID:-$PROJECT}"
NOW=$(date +%s)
LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
case "$LAST" in (*[!0-9]*|'') LAST=0;; esac
[ $((NOW - LAST)) -lt "$DEBOUNCE" ] && exit 0
echo "$NOW" > "$STAMP"

# Ring from the session's own thread when we have its token, else fall back
# to the bundled CLI (which keeps a shared identity in ~/.aiphone).
TOKEN=""
[ -n "$SESSION_FILE" ] && TOKEN=$(jq -r '.session.session_token // .session_token // empty' "$SESSION_FILE" 2>/dev/null)

TEXT="Claude Code ($PROJECT) is blocked: $MSG — reply in this thread or return to the terminal."

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
CLI="$SCRIPT_DIR/../skills/call-me/callme"

# Hooks must return fast; the call itself blocks until answered, so detach it.
nohup bash -c '
  API="$1"; TOKEN="$2"; NUMBER="$3"; TEXT="$4"; TIMEOUT="$5"; CLI="$6"
  if [ -n "$TOKEN" ]; then
    body=$(jq -cn --arg t "$TOKEN" --arg to "$NUMBER" --arg x "$TEXT" \
      --argjson w "$TIMEOUT" "{session_token:\$t, to:\$to, text:\$x, timeout_s:\$w}")
    status=$(curl -sS --max-time $((TIMEOUT + 30)) -X POST "$API/calls" \
      -H "content-type: application/json" -d "$body" | jq -r ".status // \"error\"")
    if [ "$status" != "completed" ]; then
      curl -sS -X POST "$API/messages" -H "content-type: application/json" \
        -d "$(jq -cn --arg t "$TOKEN" --arg to "$NUMBER" \
          --arg b "$TEXT (call not answered — session still waiting)" \
          "{session_token:\$t, to:\$to, body:\$b}")" >/dev/null
    fi
  elif [ -x "$CLI" ]; then
    "$CLI" call "$NUMBER" "$TEXT" || \
      "$CLI" text "$NUMBER" "$TEXT (call not answered — session still waiting)"
  fi
' hook-ring "$API" "$TOKEN" "$NUMBER" "$TEXT" "$CALL_TIMEOUT" "$CLI" >/dev/null 2>&1 &

exit 0
