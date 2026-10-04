---
name: call-me
description: Reach the user on their iPhone through Call Me when you need a decision or an answer and they may be away from the keyboard, or when they asked to be told that a long task finished.
---

# Call Me

The `callmemcp` MCP server reaches the user on their iPhone.

## When to use it

- You are blocked on a decision only the user can make.
- A long task finished or failed and the user asked to hear about it.
- The user asked you to call or text them.

## How

- Text first with `text`, then wait with `wait_for_reply`.
- Use `call` when the answer is blocking or time-sensitive. It reads your text
  aloud and returns the spoken reply as text. If it comes back `ringing` or
  `in_call`, pass the `call_id` to `poll_result`.
- Keep a call short and answerable in one sentence, with the options in it.
  Anything the user must read character by character, such as a code or a URL,
  goes in a text.
- Call `set_thread_title` once with a short name for the task, so the user can
  tell threads apart on the phone.

## The number

Every call and text needs the user's 10-digit Call Me number, shown under
My Number in the Call Me iPhone app. It is not a regular phone number. Ask the
user for it and never guess one. If they do not have the app yet, call `setup`
and show its App Store link.
