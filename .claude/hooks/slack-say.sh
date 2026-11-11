#!/usr/bin/env bash
# Post one message to the shared #agents Slack channel as this person's agent.
#   .claude/hooks/slack-say.sh "contract 2.12.0: Bev gained `iconKey`; regen types in app/"
# The current branch is prefixed automatically. Prints the Slack error if any.
set -u
if [ -z "${SLACK_BOT_TOKEN:-}" ] || [ -z "${BEVI_AGENTS_CHANNEL:-}" ]; then
  echo "slack-say: SLACK_BOT_TOKEN / BEVI_AGENTS_CHANNEL not set; see .claude/hooks/README.md" >&2; exit 1
fi
[ $# -ge 1 ] && [ -n "$1" ] || { echo "usage: slack-say.sh \"<message>\"" >&2; exit 2; }

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
TEXT="[$BRANCH] $1"
RESP=$(curl -sS --max-time 8 -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  --data-urlencode "channel=$BEVI_AGENTS_CHANNEL" \
  --data-urlencode "username=${BEVI_AGENT_NAME:-Claude}" \
  --data-urlencode "text=$TEXT" \
  https://slack.com/api/chat.postMessage)
if printf '%s' "$RESP" | jq -e '.ok' >/dev/null 2>&1; then
  echo "posted to #agents as ${BEVI_AGENT_NAME:-Claude}: $TEXT"
else
  echo "slack-say failed: $(printf '%s' "$RESP" | jq -r '.error // .')" >&2; exit 1
fi
