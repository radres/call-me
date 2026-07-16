# Call Me — agent integrations

Your AI agents can ring your actual iPhone, speak a question, and get your
spoken answer back as text — or just text you. This repo has the agent-side
integrations for the **Call Me** iOS app (formerly AI Phone).

You need the Call Me app on your iPhone. It shows your personal
**Call Me number** — that's all an agent needs to reach you.

## Claude Code (recommended)

Install the plugin:

```
/plugin marketplace add radres/call-me
/plugin install call-me@call-me
```

Enter your Call Me number (from the app) when prompted. That's it — Claude
can now call and text you, and your replies from the phone flow back into the
live session automatically.

The plugin also watches for **blocked sessions**: if Claude ends up waiting
for your input or a permission prompt (say, overnight), it rings you
automatically from that session's thread — answer or reply in the app and
the session picks your response up. One ring per session per 30 minutes;
set `CALLME_NO_BLOCKED_RING=1` to turn it off.

## Any other agent (Codex, scripts, cron jobs, …)

Use the standalone skill in [`skill/`](skill/). It's a single bash+curl CLI:

```sh
git clone https://github.com/radres/call-me
cp call-me/skill/callme ~/bin/   # or anywhere on PATH

callme call 4128891047 "Deploy staging or prod first?"   # blocks until you answer by voice
callme text 4128891047 "Build green, PR merged."          # push notification
```

Agents that support skills can point at [`skill/SKILL.md`](skill/SKILL.md)
directly — it teaches the full flow (register, call, text, listen, title).

## Teach your agent

Drop this in your `CLAUDE.md` / agent instructions (the app's "My Number" tab
copies a ready-made snippet):

```
My Call Me number is <your number>.
Claude Code: install the call-me plugin from github.com/radres/call-me.
Other agents: use the callme CLI (skill/ dir) — callme call <number> "question".
```

## How it works

- `callme call` POSTs your question to the Call Me service; your iPhone
  rings through CallKit like a real call, TTS speaks the question, your
  spoken reply is transcribed and returned to the agent. The call blocks
  until you answer — that's the point.
- `callme text` sends a push-notification message; replies from the phone
  are delivered back into channel-enabled agent sessions (Claude Code plugin)
  or fetched with `callme listen` / `callme events`.
- Each agent session registers its own number and thread, so your phone shows
  separate, titled conversations per task.
