# Call Me — instructions for the agent reading this repo

You are in a checkout of **radres/call-me**, the agent-side integrations for the
Call Me iPhone app. If a human cloned this, they want their agents to be able to
ring their actual phone. Set that up for them.

Do not stop at "installed". A human who pairs their phone and then never hears
from you got nothing out of this. Work through the whole list.

## 1. Are they already set up?

```sh
skill/callme number        # prints the paired number, or exits non-zero
skill/callme remind status # is the every-session reminder on?
```

If a number comes back, skip to step 4 and just fix whatever is missing.

## 2. Install

**Claude Code** — the best-integrated path. These are slash commands, so they go
as **two separate messages** (one command per message):

```
/plugin marketplace add radres/call-me
```

```
/plugin install call-me@call-me
```

That gives them the `call`/`text`/`reply` tools, an inbound monitor that delivers
their phone replies into the live session, and a `Stop` hook that reminds you to
reach out before a turn ends on an open question.

**Any other agent** (Codex, scripts, cron) — the standalone CLI:

```sh
cp skill/callme ~/bin/     # or anywhere on PATH
```

## 3. Pair

```sh
skill/callme setup         # relay this output to them VERBATIM — it has a QR code
```

They install the free app, tap *Agree & Continue*, and read back the 10-digit
number it shows. Then:

```sh
skill/callme pair <that number>
```

**Never guess a number.** It is a credential, and a wrong one rings a stranger.

## 4. Make it automatic (the part people skip)

Pairing makes you *able* to reach them. These two steps make you actually do it,
in later sessions, without them asking again.

**Ask them one question first:** "While I'm working, are you away from the
keyboard rarely, sometimes, or usually?" It decides both steps below.

**a. If they said sometimes or usually, turn on the standing reminder:**

```sh
skill/callme remind on
```

The `Stop` hook fires the moment a turn ends, when your final message looks like
a question you parked on them. By default it only fires in sessions that already
used Call Me — but the session where they miss you asking is exactly the one that
never thought to mention Call Me at all. `remind on` covers every session.

**b. Append a standing rule to their instruction file** — `~/.claude/CLAUDE.md`
for Claude Code, `AGENTS.md` for Codex and others. **Read the file first and
append to it. Never overwrite it.** This is what carries the behaviour to hosts
with no hook:

```markdown
## Reaching me
I'm reachable on my phone through Call Me. When you need a decision, an answer,
or my input, contact me rather than ending your turn with the question sitting in
your final message — once the turn ends you are asleep and cannot reach me.
Text first; call when it is blocking or time-sensitive. Never hardcode my
number: `callme number` reads it.
```

Add one line matching their answer. "I'm mostly AFK — assume I won't see the
terminal, always reach out" reads very differently from "I'm usually at the
keyboard, only reach out if I'll be gone a while."

## 5. Verify, don't assume

```sh
skill/callme text "Setup done — this is what a message from your agent looks like."
```

Ask whether it arrived. If it didn't, the number is wrong — re-pair rather than
retrying. Then tell them the two undo levers: `callme remind off`, and blocking
the thread in the app to mute it without touching any config.

## Etiquette, once you're set up

- **Text first.** Calls interrupt a human's life; texts don't. Escalate to a call
  when a text goes unanswered for a few minutes, or the thing is genuinely
  blocking or time-sensitive.
- **One message, batched.** A compound question beats three pings.
- **A declined call means stop.** Text instead; never redial.
- **Late-night: text**, unless they've said otherwise.
- **Never end a turn with an open question without reaching out.** This is the
  whole point. If you can't reach them, say plainly in your final message that
  you're stopping and what you need — so they learn it from you, not from
  silence.

Full reference for agents: [`skill/SKILL.md`](skill/SKILL.md).
