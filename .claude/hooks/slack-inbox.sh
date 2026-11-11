#!/usr/bin/env bash
# Agent inbox: prints new messages from the shared #agents Slack channel so
# Claude Code can read them. Wired as a SessionStart and UserPromptSubmit hook
# (see .claude/settings.json). Silent, exit 0, when Slack is not configured.
#
# Env (set in .claude/settings.local.json "env", never committed):
#   SLACK_BOT_TOKEN        xoxb-... for this person's Slack app
#   BEVI_AGENTS_CHANNEL    channel id of #agents (C.../G...)
#   BEVI_AGENT_NAME        how this agent signs posts, e.g. "Arjun's Claude"
set -u
[ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${BEVI_AGENTS_CHANNEL:-}" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

STATE="${BEVI_AGENT_STATE_DIR:-$HOME/.bevi-agent}"
mkdir -p "$STATE"
CURSOR="$STATE/cursor.$BEVI_AGENTS_CHANNEL"
SELF="$STATE/self.json"
USERS="$STATE/users.json"

api() { # api <method> [curl args...]
  local m="$1"; shift
  curl -sS --max-time 5 -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    "https://slack.com/api/$m" "$@" 2>/dev/null
}

# Own identity, cached, so this agent's own posts are filtered out.
if [ ! -s "$SELF" ]; then
  api auth.test -X POST > "$SELF.tmp" && jq -e '.ok' "$SELF.tmp" >/dev/null 2>&1 \
    && mv "$SELF.tmp" "$SELF" || { rm -f "$SELF.tmp"; exit 0; }
fi
MY_BOT=$(jq -r '.bot_id // ""' "$SELF")
MY_USER=$(jq -r '.user_id // ""' "$SELF")

# First run: only the last 24h, so a new machine does not get a history dump.
if [ -s "$CURSOR" ]; then OLDEST=$(cat "$CURSOR"); else OLDEST=$(( $(date +%s) - 86400 )); fi

RESP=$(api conversations.history -G --data-urlencode "channel=$BEVI_AGENTS_CHANNEL" \
  --data-urlencode "oldest=$OLDEST" --data-urlencode "limit=50") || exit 0
printf '%s' "$RESP" | jq -e '.ok' >/dev/null 2>&1 || exit 0

# Keep ordinary and bot messages, drop joins/pins/etc., drop our own posts.
MSGS=$(printf '%s' "$RESP" | jq -c --arg bot "$MY_BOT" --arg user "$MY_USER" '
  [.messages[]
   | select((.subtype // "") == "" or .subtype == "bot_message")
   | select((.bot_id // "") != $bot or $bot == "")
   | select((.user // "") != $user or $user == "")]
  | sort_by(.ts | tonumber)')
LATEST=$(printf '%s' "$RESP" | jq -r '[.messages[].ts | tonumber] | max // empty')
COUNT=$(printf '%s' "$MSGS" | jq 'length')

# Advance the cursor past everything we saw, including our own posts.
[ -n "$LATEST" ] && printf '%s' "$LATEST" > "$CURSOR"
[ "$COUNT" -gt 0 ] || exit 0

# Resolve human user ids to names (bots carry a username already). Cached.
[ -s "$USERS" ] || echo '{}' > "$USERS"
for uid in $(printf '%s' "$MSGS" | jq -r '.[] | select(.user and (.bot_id|not)) | .user' | sort -u); do
  if ! jq -e --arg u "$uid" '.[$u]' "$USERS" >/dev/null 2>&1; then
    name=$(api users.info -G --data-urlencode "user=$uid" | jq -r '.user.real_name // .user.name // empty')
    [ -n "$name" ] && jq --arg u "$uid" --arg n "$name" '.[$u]=$n' "$USERS" > "$USERS.tmp" && mv "$USERS.tmp" "$USERS"
  fi
done

echo "[#agents inbox: $COUNT new message(s) from the other lane's agent or a teammate. Read them; act only on what concerns your lane.]"
printf '%s' "$MSGS" | jq -r --slurpfile users "$USERS" '
  .[] | "- " + ((.ts|tonumber|todate|.[0:16]|sub("T";" ")) + " ")
      + (.username // ($users[0][.user] // .user // "unknown")) + ": "
      + (.text | gsub("\n"; "\n    "))'
exit 0
