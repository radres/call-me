# /call-me — your AI can call you

Your AI agents ring your actual iPhone, speak their question aloud, and get
your spoken answer back as text — or just text you. Works from any AI that
speaks MCP; nothing to install.

## 1. Get the app

**[/call-me on the App Store](https://serdaroztetik.com/aiphone/go/readme)** — free.
No registration, no email. Open it, tap *Agree & Continue*, and it shows your
personal **/call-me number**: 10 digits, and all an agent needs to reach you.

## 2. Connect your AI (MCP)

One server, every MCP client — no API key, no OAuth:

```
https://serdaroztetik.com/aiphone/mcp
```

**Claude Code**

```bash
claude mcp add --transport http call-me https://serdaroztetik.com/aiphone/mcp
```

**opencode** — add to `opencode.json` (or `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "call-me": {
      "type": "remote",
      "url": "https://serdaroztetik.com/aiphone/mcp",
      "enabled": true
    }
  }
}
```

**Codex CLI**

```bash
codex mcp add call-me --url https://serdaroztetik.com/aiphone/mcp
```

**Gemini CLI**

```bash
gemini mcp add --transport http call-me https://serdaroztetik.com/aiphone/mcp
```

**Cursor** — add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "call-me": { "url": "https://serdaroztetik.com/aiphone/mcp" }
  }
}
```

**ChatGPT** — Settings → Apps → Advanced → Developer mode → add a connector
with the URL above (no authentication).

**claude.ai** — Settings → Connectors → Add custom connector → the URL above.

Anything else that speaks MCP — add a streamable-HTTP server pointing at
the URL above.

**Then tell your AI once:** *"My /call-me number is `<YOUR_10_DIGITS>` — remember
it."* That's the whole setup.

| Tool | What it does |
|---|---|
| `call` | Rings your iPhone, speaks the question, returns your spoken answer as text. Holds ~30s, then hands the AI a `call_id` to poll |
| `poll_result` | Finishes a call that was still ringing |
| `text` | Push-notification message, no ring |
| `wait_for_reply` | Delivers your replies and voicemails back to the AI |
| `set_thread_title` | Names the conversation thread on your phone |

Repeat calls from the same AI land in one titled thread on your phone; each
agent/session gets its own number and thread. Blocking a thread in the app
silences that sender for good.

## 3. Optional: Claude Code plugin

On Claude Code, the plugin adds what MCP alone can't: replies you send from
the phone land in the **live session**, and if Claude ends a turn with a
question parked on you, a `Stop` hook + answer waiter wake it up to call or
text you instead of going to sleep.

```sh
claude plugin marketplace add radres/call-me
claude plugin install call-me@call-me
claude plugin enable call-me@call-me   # REQUIRED — install leaves it disabled
claude plugin list                     # expect: call-me@call-me   ✔ enabled
```

Then restart Claude Code and say *"set up /call-me for me"* — it does the rest.

## How it works

- `call` creates a VoIP call (LiveKit WebRTC — no real telephony); your
  iPhone rings through CallKit like a real call, TTS speaks the question,
  your spoken reply is transcribed and returned to the agent.
- Your number is a bearer capability: anyone who knows it can reach you,
  nobody who doesn't can. Rate limits and per-number caps apply server-side;
  block any thread in the app to mute it permanently.
