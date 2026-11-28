# /call-me for Antigravity

**Let your agent call their human.**

Your agent rings your phone, reads its question aloud, and gets your spoken
answer back as text. It can also text you and wait for your reply, so a long
task keeps moving while you are away from the keyboard: approve a deploy from
the kitchen, answer a question on a walk, or hear that the build finished.

/call-me is a voice relay, not a voice assistant. Your agent does all the
thinking; /call-me carries its words to your phone and your answer back.

## Setup

1. Install the plugin:

   ```bash
   git clone https://github.com/radres/call-me
   agy plugin install call-me/antigravity
   ```

   (or from the Antigravity Marketplace once it is listed).
2. Install /call-me on your phone from the
   [App Store](https://callmemcp.com/go/antigravity) (iPhone) or
   [Google Play](https://callmemcp.com/go/play-antigravity) (Android).
3. Open the app and give your agent the 10-digit number under **My Number**.
   That number is not a phone number and it is the only credential: no login,
   no OAuth, no API key.

Ringing a real phone needs a /call-me subscription in the app. To try the loop
first without a phone, use the demo line `5550001234`: it answers by itself.

## Try it

- "Try /call-me on the demo line 5550001234: call it and ask whether to ship."
- "Text my phone when this task is done, and call me if you get blocked on a decision."
- "Keep working while I'm away and call me before anything you can't undo."

## What it ships

- `mcp_config.json`: one hosted MCP server, `https://callmemcp.com/mcp`
  (Streamable HTTP, no OAuth).
- `skills/call-me/SKILL.md`: when to reach the user, and how.

No hooks, no scripts, no local code.

## Tools

| Tool | What it does |
| --- | --- |
| `call` | Rings your phone, reads the question aloud word for word, returns your spoken answer as text. |
| `say` | Speaks the next line on a call that is still open, and returns your answer. |
| `hang_up` | Ends a call, with an optional spoken goodbye. |
| `poll_result` | Checks on a call that is still ringing or in progress. |
| `text` | Sends a one-way text (a push notification, no ring). |
| `wait_for_reply` | Waits for the texts and voicemail transcripts you send back. |
| `play_audio` | Calls you and plays a recording or audio link. |
| `set_thread_title` | Names the conversation thread on your phone. |
| `setup` | First-time setup instructions with the App Store and Google Play links. |

## Network, credentials and data

- Network: `https://callmemcp.com/mcp` only.
- Credentials: none. Each call or text carries your 10-digit /call-me number,
  which routes it to your phone and nobody else's.
- Data: the text the agent sends and the transcript of your spoken answer,
  stored so the phone app can show the conversation.
  [Privacy policy](https://callmemcp.com/privacy) ·
  [Terms](https://callmemcp.com/terms) ·
  [Support](https://callmemcp.com/support)

## License

MIT, see [LICENSE](LICENSE).
