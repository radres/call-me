# Call Me

The `call-me` MCP server reaches the user on their phone (iPhone or Android). Use it when you need
a decision, an answer or their input and they may be away from the keyboard.

- `call` rings their phone, speaks your text aloud and returns their spoken
  answer as text.
- `text` sends a message to their phone; `wait_for_reply` waits for the reply.
- Both need the user's 10-digit Call Me number, shown in the Call Me app.
  Ask for it once and never guess it. If they do not have one, run `setup` and
  show its output, including the App Store and Google Play links.
- Text first; call when the question is blocking or time-sensitive.
