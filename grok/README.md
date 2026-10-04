# /call-me for Grok Build

Your agent rings your iPhone, reads its text aloud, and gets your spoken answer
back as text. It can also text you and wait for your reply.

## Install

```bash
grok plugin install radres/call-me#grok
```

Then install [Call Me](https://apps.apple.com/app/call-me/id6789575165) on your
iPhone and give Grok the 10-digit number under My Number. Ringing a phone needs
a Call Me subscription in the app, which starts with a free trial.

## What it ships

- `.mcp.json`: one hosted MCP server, `https://callmemcp.com/mcp` (Streamable HTTP).
- `skills/call-me/SKILL.md`: when to reach the user, and how.

No hooks, no scripts, no local code.

## Network and credentials

- Network: `https://callmemcp.com/mcp` only.
- Credentials: none. No OAuth and no API key. Each call or text carries the
  user's 10-digit Call Me number, which routes it to their phone.
- Data: the text the agent sends and the transcript of the spoken answer,
  stored so the phone app can show the conversation.
  [Privacy policy](https://callmemcp.com/privacy) · [Terms](https://callmemcp.com/terms)

## License

MIT, see [LICENSE](../LICENSE).
