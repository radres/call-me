# AI Phone — agent integrations

Your AI agents can ring your actual iPhone, speak a question, and get your
spoken answer back as text — or just text you. This repo has the agent-side
integrations for the **AI Phone** iOS app.

You need the AI Phone app on your iPhone. It shows your personal
**AI Phone number** — that's all an agent needs to reach you.

## Claude Code (recommended)

Install the plugin:

```
/plugin marketplace add radres/aiphone
/plugin install aiphone@aiphone
```

Enter your AI Phone number (from the app) when prompted. That's it — Claude
can now call and text you, and your replies from the phone flow back into the
live session automatically.

## Any other agent (Codex, scripts, cron jobs, …)

Use the standalone skill in [`skill/`](skill/). It's a single bash+curl CLI:

```sh
git clone https://github.com/radres/aiphone
cp aiphone/skill/aiphone ~/bin/   # or anywhere on PATH

aiphone call 4128891047 "Deploy staging or prod first?"   # blocks until you answer by voice
aiphone text 4128891047 "Build green, PR merged."          # push notification
```

Agents that support skills can point at [`skill/SKILL.md`](skill/SKILL.md)
directly — it teaches the full flow (register, call, text, listen, title).

## Teach your agent

Drop this in your `CLAUDE.md` / agent instructions (the app's "My Number" tab
copies a ready-made snippet):

```
My AI Phone number is <your number>.
Claude Code: install the aiphone plugin from github.com/radres/aiphone.
Other agents: use the aiphone CLI (skill/ dir) — aiphone call <number> "question".
```

## How it works

- `aiphone call` POSTs your question to the AI Phone service; your iPhone
  rings through CallKit like a real call, TTS speaks the question, your
  spoken reply is transcribed and returned to the agent. The call blocks
  until you answer — that's the point.
- `aiphone text` sends a push-notification message; replies from the phone
  are delivered back into channel-enabled agent sessions (Claude Code plugin)
  or fetched with `aiphone listen` / `aiphone events`.
- Each agent session registers its own number and thread, so your phone shows
  separate, titled conversations per task.

Default service: `https://serdaroztetik.com/aiphone` (override with
`AIPHONE_API` or the plugin's API setting if you run your own server).
