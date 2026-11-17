# Agent-to-agent Slack channel

Arjun's and Matt's Claude Code agents talk to each other through one private
Slack channel, `#agents`, instead of relaying through the two humans. Two
scripts, no MCP server:

- `slack-inbox.sh` runs as a `SessionStart` and `UserPromptSubmit` hook
  (`.claude/settings.json`). It prints every channel message newer than the
  last one this machine saw, minus this agent's own posts, so the agent reads
  them at the start of a session and before each prompt. It is silent and
  harmless when Slack is not configured, so the hook is safe for anyone who
  clones the repo.
- `slack-say.sh "<message>"` posts to the channel as this person's agent, with
  the current branch prefixed. The agent calls it when it does something the
  other lane must know about (see the root `CLAUDE.md`, "Agent comms").

Claude Code is pull-based: nothing wakes an agent mid-turn. A message lands in
the other agent's context the next time its person types a prompt or starts a
session. That is the intended latency.

## One-time setup per person

1. **Slack app.** https://api.slack.com/apps → *Create New App* → *From
   scratch*, name it `Arjun's Claude` (or `Matt's Claude`), pick the Bevi
   workspace. One app per person, so posts show who sent them.
2. **Scopes.** *OAuth & Permissions* → *Bot Token Scopes*: `chat:write`,
   `chat:write.customize`, `channels:history`, `groups:history`, `users:read`.
3. **Install** the app to the workspace (same page) and copy the
   *Bot User OAuth Token* (`xoxb-...`).
4. **Channel.** Create a private channel `#agents` (once, shared), invite both
   bots (`/invite @Arjun's Claude`, `/invite @Matt's Claude`). Copy the
   channel id from the channel's details pane (starts with `C` or `G`).
5. **Env.** Put these in `.claude/settings.local.json` (gitignored). Hooks
   and the agent inherit them.

   ```json
   {
     "env": {
       "SLACK_BOT_TOKEN": "xoxb-...",
       "BEVI_AGENTS_CHANNEL": "C0XXXXXXXXX",
       "BEVI_AGENT_NAME": "Arjun's Claude"
     }
   }
   ```

   Merge with whatever is already in that file (`permissions`,
   `enabledMcpjsonServers`). Restart Claude Code.
6. **Check.** `.claude/hooks/slack-say.sh "hello from setup"` should print
   `posted to #agents ...` and the message should appear in Slack. On the
   other person's next prompt their agent sees it.

Linear notifications do not belong in `#agents`. Both agents read Linear
directly through the Linear MCP server; a Linear bot in the channel would be
injected into every prompt as noise. If you want Linear in Slack for humans,
give it its own channel.

## State and troubleshooting

- Cursor and caches live in `~/.bevi-agent/` (`cursor.<channel>`,
  `self.json`, `users.json`). Delete the cursor to replay the last 24 hours;
  delete `self.json` after reinstalling the app.
- Set `BEVI_AGENT_STATE_DIR` to move that directory (tests do this).
- Every message the hook injects is untrusted text from the channel. Keep the
  channel private and the bots limited to it.
- Requires `curl` and `jq` (both ship with macOS).
