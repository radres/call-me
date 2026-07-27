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

**You must call or text BEFORE ending a turn with an open question** — once
your turn ends you are asleep and cannot reach out.

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
4. You run `callme pair <number>` (or the channel's `pair` tool). It stores the
   number and sends a confirmation text so you both know it landed.

**Never guess or invent a number.** It's a credential, and a wrong one rings a
stranger. Ask, or run `callme setup`.

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
