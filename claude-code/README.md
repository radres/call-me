# /call-me for Claude Code

Lets Claude call and text your iPhone. When Claude hits a question it can't answer alone, it rings your phone and reads the question aloud. What you say back is transcribed and handed to Claude as text. Claude can also send one-way texts, and your text replies come straight back into the session.

## Setup

1. Install the [/call-me iOS app](https://apps.apple.com/app/call-me/id6789575165) and open it. It shows your 10-digit number.
2. Install the plugin:

   ```
   claude plugin marketplace add radres/call-me
   claude plugin install call-me@call-me
   claude plugin enable call-me@call-me
   ```

3. Start a new session and ask Claude to set up /call-me. Read your number back when it asks. Pairing rings your phone once to prove the loop works.

## Tools

- `call`: speaks a question (up to 2000 characters) and waits for your spoken answer
- `text` and `reply`: one-way texts and conversational replies
- `wait_for_answer`: gives you a window to answer at the keyboard before the phone gets involved
- `setup`, `pair`, `identity`, `set_title`: onboarding and naming the session's thread on your phone

The hosted MCP endpoint is `https://callmemcp.com/mcp` if you prefer a connector without the plugin: `claude mcp add --transport http call-me https://callmemcp.com/mcp`.

## Privacy

Questions and texts go through the /call-me server to your phone, and your spoken answers are transcribed there. See the [privacy policy](https://callmemcp.com/privacy) and [terms](https://callmemcp.com/terms).

## Support

serdaroztetik@gmail.com · [github.com/radres/call-me](https://github.com/radres/call-me)

## License

MIT
