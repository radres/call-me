# Call Me

While promoted in Claude Code forums, call me does not require LLMs at all. It is simply an http endpoint where you can call with `call-me cli` like `call-me "hello, how are you"` then you get an answer back. This is extremely simple for agents to learn an incorporate it into their workflow.

You do not need to keep telling agent `/call-me`, just tell it to install the stop hooks from this repo. Then at the end of each conversation it decides to call you right away, or maybe even spawn monitors.

# Agent integrations

Your AI agents can ring your actual iPhone, speak a question, and get your
spoken answer back as text — or just text you. This repo has the agent-side
integrations for the **Call Me** iOS app (formerly AI Phone).



## Quick Start (`curl` API)

## 1. Get the app

You need the app to receive a fake phone number. No registration, no email nothing. Just a phone number and an HTTP request.

**[Call Me on the App Store](https://serdaroztetik.com/aiphone/go/readme)** — free.
Open it, tap *Agree & Continue*, and it shows your personal **Call Me
number**: 10 digits, and all an agent needs to reach you.

Already in a terminal with the CLI? `callme qr` prints a scannable QR code for
that link, and `callme setup` prints these steps for you.

To make a call or send a text directly using `curl` without CLI or plugins:

```bash
# 1. Register a session (label sets the caller/thread name shown on the iPhone)
TOKEN=$(curl -s -X POST https://serdaroztetik.com/aiphone/sessions \
  -H "Content-Type: application/json" \
  -d '{"label": "Deploy Bot"}' | jq -r .session_token)

# (Optional) Update caller label on an existing session token:
curl -s -X POST https://serdaroztetik.com/aiphone/sessions/label \
  -H "Content-Type: application/json" \
  -d "{
    \"session_token\": \"$TOKEN\",
    \"label\": \"Staging Release Bot\"
  }"

# 2. Ring phone & wait for spoken answer (blocks until answered)
curl -s -X POST https://serdaroztetik.com/aiphone/calls \
  -H "Content-Type: application/json" \
  -d "{
    \"session_token\": \"$TOKEN\",
    \"to\": \"<10_DIGIT_PHONE_NUMBER>\",
    \"text\": \"Should I proceed with deployment?\",
    \"timeout_s\": 300
  }"
# Output: {"status":"completed","transcript":"Yes, go ahead"}

# 3. Send a text notification
curl -s -X POST https://serdaroztetik.com/aiphone/messages \
  -H "Content-Type: application/json" \
  -d "{
    \"session_token\": \"$TOKEN\",
    \"to\": \"<10_DIGIT_PHONE_NUMBER>\",
    \"body\": \"Task finished successfully.\"
  }"
```



## 2. Connect Claude Code (recommended)

claude code folder also includes hooks for claude to call you after long-running sessions.

Send these as **three separate messages** (slash commands only run one per
message):

```
/plugin marketplace add radres/call-me
```

```
/plugin install call-me@call-me
```

```
/plugin enable call-me@call-me
```

**Do not skip the third one.** `install` leaves the plugin *disabled* — it says
so in its own output — and a disabled plugin gives Claude no `call`/`text`
tools at all, so nothing will ever reach your phone.

Then **restart Claude Code** — the inbound monitor only comes up in a fresh
session.

<details>
<summary>Prefer one line in a terminal, or want to just ask Claude to do it?</summary>

Same thing, non-interactively — this also works before Claude Code has ever been
launched, and an agent can run it itself:

```sh
claude plugin marketplace add radres/call-me
claude plugin install call-me@call-me
claude plugin enable call-me@call-me   # REQUIRED — install leaves it disabled
claude plugin list                     # expect: call-me@call-me   ✔ enabled
```

So "install Call Me for me" is a complete instruction — you don't have to type
the slash commands yourself.
</details>

Then paste this message, and Claude does the rest of the setup itself:

```
Set up Call Me for me, all of it — not just pairing. If the plugin isn't
installed yet, install it yourself with the `claude plugin` shell commands. Run
the setup tool and show me its output verbatim so I can scan the QR code. Ask me
how often I'm away from the keyboard, then based on my answer: turn on the
standing reminder if it fits, append a "## Reaching me" rule to my
~/.claude/CLAUDE.md (read it first and append — don't overwrite), and prove it
works end to end. Tell me how to undo both when you're done.
```

That gets you the fully automated setup: Claude can reach your phone, **and** it
will actually do so in future sessions instead of parking a question in a final
message and going to sleep. Concretely it sets up:

| | What it does |
|---|---|
| **`call` / `text` / `reply` tools** | Claude rings your phone or texts it; your spoken answer comes back as text |
| **Inbound monitor** | Replies you send from the app land in the live Claude session, even hours later |
| **`Stop` hook** | At the instant a turn ends, if Claude's last message looks like a question it parked on you, it gets reminded to reach out. It reminds — it never dials on its own |
| **`~/.claude/CLAUDE.md` rule** | Carries the behaviour to every session and to hosts with no hook |

The number lands in `~/.aiphone/config.json`, so **every** Claude session on the
machine reaches your phone, and re-pairing to a new phone takes effect
immediately without restarting anything. You can also paste the number into the
plugin's config field when prompted — same result.

Two levers afterwards: `callme remind off` stops the every-session reminder, and
blocking a thread in the app mutes it without touching any config.

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

The setup in step 2 writes this for you. If you'd rather do it by hand, append it
to your `CLAUDE.md` / `AGENTS.md`:

```markdown
## Reaching me
I'm reachable on my phone through Call Me. When you need a decision, an answer,
or my input, contact me rather than ending your turn with the question sitting in
your final message — once the turn ends you are asleep and cannot reach me.
Text first; call when it is blocking or time-sensitive. Never hardcode my
number: `callme number` reads it.
```

Add a line about how reachable you actually are — "I'm mostly AFK, assume I won't
see the terminal" produces very different behaviour from "I'm usually at the
keyboard." That one line is the difference between an agent that pings you
constantly and one that never does.

Notice there's no number in there: the number is a credential, so it lives in
`~/.aiphone/config.json` (mode 0600) instead of your notes. `callme number`
reads it back, `callme pair <number>` changes it.

**Cloned this repo?** Then you don't need any of the above — `CLAUDE.md` at the
repo root is picked up automatically, and it walks your agent through the whole
setup. Just say "set up Call Me".

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
