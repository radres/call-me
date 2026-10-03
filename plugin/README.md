# Call Me plugin

A portable [Agent Plugins](https://agent-plugins.org) package for Call Me. It
also carries a Cursor manifest, so it installs as a Cursor plugin.

Call Me lets your agent ring your iPhone, read you a question, an update or your
day ahead, and get your spoken reply back as text, or just text you. It is not a voice assistant and
has no model of its own: your agent does the thinking, Call Me only carries the
question to your phone and the answer back. Use it to keep a long task moving
while you drive, train or walk.

## What is inside

| File | For |
|---|---|
| `plugin.json` | Agent Plugins 1.0.0 manifest |
| `mcp.json` | The hosted MCP server, `https://serdaroztetik.com/aiphone/mcp` (Streamable HTTP, no auth) |
| `skills/call-me/SKILL.md` | When and how the agent should call or text you |
| `.mcp.json` | The same server in Cursor's own format, which has no `type` field |
| `.cursor-plugin/plugin.json` | Cursor manifest and logo |

Nothing runs on your machine. The plugin only points your client at the hosted
server and teaches the agent to use it.

## Setup

1. Install [Call Me](https://serdaroztetik.com/aiphone/go/agent-plugin) on your
   iPhone and open **My Number**. Those 10 digits are all an agent needs.
2. Install this plugin in your client. In Cursor: add it from
   [cursor.directory](https://cursor.directory), or copy this folder to
   `~/.cursor/plugins/local/call-me` and reload the window.
3. Ask the agent: *"text the Call Me demo line 5550001234 to check it works"*.
   The demo line answers by itself, so nobody's phone rings.
4. Then give it your number: *"my Call Me number is …, call me when the build
   finishes"*.

Connecting costs nothing. Reaching a real phone needs an active subscription in
the iPhone app, with a free trial for eligible accounts.

## Tools

| Tool | What it does |
|---|---|
| `call` | Rings your iPhone, reads your text aloud (a question, an update, a summary of the day ahead), returns your spoken reply as text |
| `poll_result` | Finishes a call that was still ringing |
| `text` | Push-notification message, no ring |
| `wait_for_reply` | Delivers your replies and voicemails back to the agent |
| `set_thread_title` | Names the conversation thread on your phone |
| `setup` | First-setup instructions and the App Store link |

Your number is a bearer capability: whoever has it can reach your phone, nobody
else can. Calls and texts are rate limited, and blocking a thread in the app
silences that sender for good.
