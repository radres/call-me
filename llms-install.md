# Installing Call Me in Cline

Call Me is a hosted remote MCP server. There is nothing to clone, build or run:
no package, no API key, no OAuth. Setup is one settings entry and one number
from the user.

Know what it is before you set it up: Call Me does no thinking and holds no
conversation. It is a voice relay. You decide what to ask; Call Me rings the
user's iPhone, reads your question aloud, and hands their spoken answer back to
you as text. It is for when the user is away from the keyboard: driving, at the
gym, out for a walk.

## 1. Add the server

Add this entry under `mcpServers` in Cline's MCP settings file, keeping any
servers already there:

- Cline in VS Code / JetBrains: MCP Servers → Configure → "Configure MCP Servers"
  opens the file.
- Cline CLI: `~/.cline/data/settings/cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "call-me": {
      "type": "streamableHttp",
      "url": "https://serdaroztetik.com/aiphone/mcp",
      "timeout": 120,
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

`timeout` is in seconds. `call` holds for up to about 30 seconds while the phone
rings, so keep it at 120 or higher.

## 2. Check it works, no phone needed

`5550001234` is a demo line that answers by itself. Call the `text` tool with
`to: "5550001234"` and `body: "Cline setup test"`. A result with `"ok": true`
means the server is connected. `call` with `to: "5550001234"` and any question
comes back `completed` with an automated transcript after a few seconds.

## 3. Pair the user's phone

1. If `~/.aiphone/config.json` exists, read its `user_number` and skip to step 4.
2. Otherwise the user needs the Call Me iPhone app:
   [Download Call Me from the App Store](https://apps.apple.com/app/call-me/id6789575165).
   It shows a 10-digit Call Me number under **My Number**. That number is the
   only credential. Ask the user for it. Never guess one, and never use a number
   from an example.
3. Save it so later sessions reuse it:

   ```bash
   mkdir -p ~/.aiphone && chmod 700 ~/.aiphone
   printf '{"user_number":"%s"}\n' "<10 digits>" > ~/.aiphone/config.json
   chmod 600 ~/.aiphone/config.json
   ```

4. The hosted server cannot read that file. Pass the number as `to` on every
   `call` and `text`.

A Call Me number needs an active subscription, started in the iPhone app. If a
tool answers "this /call-me number is not active", tell the user; you cannot
fix it from here.

## 4. Tools

| Tool | Use |
|---|---|
| `call` | `question`, `to`, `from_label` (e.g. `"Cline"`), optional `session_token`. Rings the phone and returns `completed` with the spoken answer as `transcript`, or `ringing` with a `call_id` |
| `poll_result` | `call_id`, `session_token`. Finishes a call that came back `ringing`; one or two polls settle it |
| `text` | `body`, `to`, `from_label`. A push notification, no ring |
| `wait_for_reply` | `session_token`, `cursor`. Returns what the user sent back: texts, voicemail transcripts |
| `set_thread_title` | `session_token`, `title`. Names this conversation's thread on the phone |
| `setup` | Returns the App Store link when no number is known |

Reuse the `session_token` from the first result so every call and text from this
task lands in one thread on the phone. If a call comes back `missed` or
`declined`, send one `text` instead of calling again.
