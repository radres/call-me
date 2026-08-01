---
name: call-me
description: Call or text your human's actual iPhone and handle replies from the Call Me app. Use when the user says "call me", "ring me", "phone me if something comes up", "text my phone", asks the agent to stay reachable, or sends an inbound Call Me message or voicemail. The phone rings through CallKit, spoken answers return as transcripts, and channel-enabled hosts deliver later messages directly into the active agent session.
---

# Call Me — call your human

Use english always, test to speech always expects english

Your human's iPhone runs the Call Me app. It gave them a **user number**
(10 digits, e.g. `584-158-6160`) — that's all you need to ring their actual
phone and get a spoken answer.

Prefer the host's Call Me tools when available. Otherwise use the `callme`
CLI from this skill directory or `PATH` (`aiphone` is a legacy alias).

If the host did not expose this skill or the CLI is unavailable, **do not stop**:
the production API has a tokenless curl-first endpoint. Read the paired number
from `~/.aiphone/config.json` (never hardcode a remembered number) and call it
directly:

```sh
CALLME_TO=$(jq -r .user_number ~/.aiphone/config.json)
curl -sS https://serdaroztetik.com/aiphone/ring \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg to "$CALLME_TO" --arg text "Should I deploy to prod?" \
    --arg from "Codex" '{to:$to,text:$text,from:$from}')"
```

`POST /ring` blocks until the spoken answer returns. It needs no token, plugin,
or registration; the 10-digit recipient number is the bearer capability. Use
`POST /text` with `body` instead of `text` for a non-blocking notification.

**You must call or text BEFORE ending a turn with an open question** — once
your turn ends you are asleep and cannot reach out. Parking it in an interactive
question widget does not count: that waits silently on a screen they may not be
looking at, and no hook can see it.

**On a Claude Code host, install the plugin instead of relying on this CLI.**
It adds the `call`/`text`/`reply` tools, delivers their phone replies back into a
live session, and installs a `Stop` hook that catches you ending a turn on a
question — none of which this CLI can do. You can install it yourself with Bash;
slash commands are only for a human at a prompt:

```sh
claude plugin marketplace add radres/call-me
claude plugin install call-me@call-me
claude plugin enable call-me@call-me   # REQUIRED — install leaves it DISABLED
claude plugin list                     # expect: call-me@call-me   ✔ enabled
```

Do not drop the `enable` line. `install` writes `"call-me@call-me": false` into
`~/.claude/settings.json` and says so in its output; a disabled plugin exposes
no tools at all, so skipping it looks exactly like a successful install and then
silently never works.

Then tell them to **restart Claude Code** (`/reload-plugins` is not yours to run,
and the monitor needs a fresh session). Pairing carries over either way — it is
the same `~/.aiphone/config.json`.

## Is the human set up yet?

The paired number lives in `~/.aiphone/config.json`. `callme number` prints it;
`call`/`text` use it automatically, so you never need to type a number.

If nothing is paired (`callme call` exits 5, or a channel tool says "not
paired"), onboard them:

```sh
callme setup      # steps + scannable QR + link — paste the whole output back
callme qr         # just the App Store QR code, if that's all you need
```

Always show them **both** the QR code and the link — relay `callme setup`'s
output verbatim, code block and all, rather than summarising it. They are on a
phone; a code to point the camera at beats retyping a URL. Both commands print
the code whether or not stdout is a terminal, so piping it through a tool is
fine.

1. They install Call Me (free): https://apps.apple.com/app/id6789575165
2. They open it, tap *Agree & Continue*, and it shows their 10-digit number.
3. They read the number back to you.
4. Tell them their phone is about to ring, then run `callme pair <number>` (or the
   channel's `pair` tool). It stores the number and **rings the phone**, blocking
   until they speak, then prints the transcript — one answered call proves push
   delivery, CallKit, audio both ways and transcription at once. If nobody picks
   up within 90s it falls back to a confirmation text and tells you so.

**Never guess or invent a number.** It's a credential, and a wrong one now *rings*
a stranger rather than texting one. Ask, or run `callme setup`.

### Onboarding is not finished when pairing succeeds

Pairing makes you *able* to reach them. It does not make you *do* it — and a
human who set up Call Me and then never hears from you got nothing out of it.
The most common outcome of a half-finished setup is: you park a question in your
final message, the turn ends, you go to sleep, and they find out hours later
that you were waiting. Close that gap in the same session you pair, in order:

1. **Ask how often they're away.** "While I work, are you away from the keyboard
   rarely, sometimes, or usually?" One question, and it decides the rest.
2. **If sometimes or usually, turn on the standing reminder:**
   ```sh
   callme remind on
   ```
   On Claude Code the plugin ships a `Stop` hook that reminds you, at the moment
   a turn ends, when your last message looks like a parked question. By default
   it only fires in sessions that already used Call Me — so a session that never
   thinks to mention it stays silent, which is precisely the session where they
   miss you asking. `remind on` makes it fire in every session. (`callme remind
   off` / `status` to change or check it later.)
3. **Write the standing rule into their instruction file** — `~/.claude/CLAUDE.md`
   for Claude Code, `AGENTS.md` for Codex and others. **Read it first and append;
   never overwrite.** This is what carries the behaviour into sessions that have
   no hook at all:
   ```markdown
   ## Reaching me
   I'm reachable on my phone through Call Me. When you need a decision, an
   answer, or my input, contact me rather than ending your turn with the
   question in your final message — once the turn ends you are asleep and
   cannot reach me. Text first; call when it is blocking or time-sensitive.
   Never hardcode my number: `callme number` reads it.
   ```
   Add one line matching their answer from step 1 — "I'm mostly AFK, assume I
   won't see the terminal" reads very differently from "I'm usually at the
   keyboard, only reach out if I'll be gone a while."
4. **Verify, don't assume.** If the pairing call was answered you are already
   done — that transcript *is* the proof. Only if it went unanswered:
   ```sh
   callme text "Setup done — this is what a message from your agent looks like."
   ```
   Ask whether it arrived. If nothing lands either way the number is wrong:
   re-pair. Don't retry blindly.
5. **Tell them how to undo it**: `callme remind off`, and blocking the thread in
   the app mutes it without touching any config.

## Inbound messages

Treat an authenticated Call Me channel event as a new user message in the
current session. Continue the relevant work and use the channel's reply tool
when a response belongs in the phone conversation.

- Claude Code with the Call Me channel receives messages automatically.
- Codex needs the Call Me companion/App Server bridge for automatic delivery.
- Without either integration, use the manual `callme listen` fallback below.

## CLI setup (when no channel is present)

```sh
callme register "claude: <project> — <task>"   # label shows as caller ID
```

Stores *your own* session number + secret token in `~/.aiphone/session.json`
(separate from the human's paired number). Auto-runs on first use if you skip
it, but a descriptive label is much better for the human.

## Ask for input — text first, call if no answer (THE main move)

Default to messaging. Only escalate to a call when a few minutes pass with
no reply, or the answer is genuinely time-sensitive and blocking.

1. Send the question non-blocking:
   ```sh
   callme text "I can fix the flaky test two ways: skip it or rewrite the fixture. Which do you want?"
   ```
2. Don't sit blocked in the terminal. Keep doing any work that doesn't
   depend on the answer while you wait.
3. To actively wait for the reply, use `callme listen` via Bash with
   `run_in_background: true` (or rely on the channel's automatic delivery
   on hosts that have it) — do not sleep-poll.
4. If a few minutes pass with no reply, escalate to a real call with the
   same question:
   ```sh
   callme call "I can fix the flaky test two ways: skip it or rewrite the fixture. Which do you want?"
   ```
   - Phone rings with the native call UI; your label is the caller name.
   - The question is spoken aloud; the human answers by voice; you get
     `ANSWER: <transcript>` on stdout. The command BLOCKS until then — that's
     the point (you can't proceed without the answer).
   - Exit 3 = missed/declined/timeout. Fall back to your best judgment and
     say so in a follow-up text.
   - Keep questions short (≤600 chars), self-contained, answerable in one
     sentence. Include the options in the question.
5. If a call is declined, do NOT retry the call — send a text instead.

### If you text and keep working, park a check-back

The failure mode here is silent: you text a question, work on something else,
finish that work, and end your turn — and the unanswered question is simply
lost, because ending the turn puts you to sleep. Before you end a turn with a
question still outstanding, do one of:

- **Escalate to `callme call`** if the answer is actually blocking. It blocks
  until they speak, so the answer cannot go missing.
- **Schedule a check-back** if it can wait: a one-shot scheduled prompt (on
  Claude Code, `CronCreate` with `recurring: false`; other hosts may expose a
  wakeup tool) that re-enters the session later to see whether they replied.
  Note the limits before you rely on it — these schedules live only inside the
  current session, and recurring ones expire after 7 days.
- **Say plainly that you are stopping** with the question open, so the human
  learns about it from your final message rather than from silence.

On Claude Code the plugin also ships a `Stop` hook that catches this: if your
final message looks like a parked question it reminds you, once, before you go
idle. Treat that as a safety net, not the plan — it is suppressed by debounce
and can be dropped on some turn-ending paths.

## Text — non-blocking notification

Use when nothing is needed back from the human (status update, FYI):

```sh
callme text "Build green, PR #142 merged. Nothing needed from you."
```

## Title the thread

The phone shows your session as a conversation thread. Once the topic is
clear (and when it shifts), set a short 3-5 word title so the human can tell
threads apart — the `set_title` tool on channel-enabled hosts, otherwise:

```sh
callme title "flaky test fix"
```

## Manual listen fallback

`callme listen` long-polls and exits when an event arrives (user text,
voicemail transcript, missed-call notice). Use only when the host has no
Call Me channel or companion bridge:

1. Run `callme listen` via Bash with `run_in_background: true`.
2. Continue other work; when the human texts/calls, the background task
   completes and you get the notification with the event on stdout.
3. Re-arm by launching it again if you still expect input.

Voicemail: the human can dial YOUR session number in their app and speak a
message; it arrives as a `voicemail` event with the transcript.

`callme events` drains pending events without waiting.

## Etiquette (important)

- **Calls interrupt a human's life; texts don't.** Always message first —
  reserve calls for when a text goes unanswered for a few minutes, or the
  human explicitly asked to be called.
- Batch questions: one message with a compound question beats three.
- Late-night: prefer text unless they said otherwise.
- Never call numbers you weren't given. The number is a credential — use the
  paired one (no number argument) rather than typing digits.
- If a call is declined, do NOT retry the call; text instead.
