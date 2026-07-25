# Call Me — agent integrations

Your AI agents can ring your actual iPhone, speak a question, and get your
spoken answer back as text — or just text you. This repo has the agent-side
integrations for the **Call Me** iOS app (formerly AI Phone).

## 1. Get the app

**[Call Me on the App Store](https://apps.apple.com/app/id6789575165)** — free.
Open it, tap *Agree & Continue*, and it shows your personal **Call Me
number**: 10 digits, and all an agent needs to reach you.

Already in a terminal with the CLI? `callme qr` prints a scannable QR code for
that link, and `callme setup` prints these steps for you.

## 2. Connect Claude Code (recommended)

Send these as **two separate messages** (slash commands only run one per
message):

```
/plugin marketplace add radres/call-me
```

```
/plugin install call-me@call-me
```

Then just tell Claude: **"set up Call Me"**. It asks for the number from the
app, remembers it, and sends you a confirmation text. From then on Claude can
text you and ring your phone, and your replies from the app flow straight back
into the live session.

You can also paste the number into the plugin's config field when prompted —
same result. Either way it lands in `~/.aiphone/config.json`, so **every** Claude
session on the machine reaches your phone, and re-pairing to a new phone takes
effect immediately without restarting anything.

## 3. Any other agent (Codex, scripts, cron jobs, …)

Use the standalone skill in [`skill/`](skill/). It's a single bash+curl CLI:

```sh
git clone https://github.com/radres/call-me
cp call-me/skill/callme ~/bin/   # or anywhere on PATH

callme pair 5551234567                  # once — the number from the app
callme call "Deploy staging or prod first?"   # blocks until you answer by voice
callme text "Build green, PR merged."         # push notification
```

Agents that support skills can point at [`skill/SKILL.md`](skill/SKILL.md)
directly — it teaches the full flow (setup, pair, call, text, listen, title).

## Teach your agent

Drop this in your `CLAUDE.md` / agent instructions:

```
I'm reachable on my phone through Call Me.
Claude Code: install the call-me plugin from github.com/radres/call-me,
then run its setup tool if we aren't paired yet.
Other agents: use the callme CLI (skill/ dir) — `callme setup` explains
pairing, then `callme call "question"` rings me and returns what I say.
```

Notice there's no number in there: the number is a credential, so it lives in
`~/.aiphone/config.json` (mode 0600) instead of your notes. `callme number`
reads it back, `callme pair <number>` changes it.

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
