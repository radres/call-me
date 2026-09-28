# n8n: approve an action by phone call

[`approve-by-phone.json`](approve-by-phone.json) is an n8n workflow that rings a
person's iPhone, asks for a yes or no out loud, and carries on from the answer.
Use it in front of any step that should not run until someone says yes: a
deploy, a refund, an email to a customer.

Call Me is only the phone line. The n8n AI Agent writes the question and decides
what the answer means; Call Me reads the question aloud and returns what the
person said as text.

## Import

n8n → **Workflows** → **Import from File** (or paste the JSON onto the canvas).
It needs n8n 2.x, where the MCP Client and MCP Client Tool nodes are built in.

1. Add an OpenAI credential to **OpenAI Chat Model**.
2. Run it. The number is the Call Me demo line, `5550001234`, which answers
   "yes" by itself, so no phone rings.
3. Install [Call Me](https://serdaroztetik.com/aiphone/go/n8n) on your iPhone
   and put the 10-digit number from **My Number** into **Configure me**.
   Reaching a real phone needs an active Call Me subscription.
4. Replace **Do the approved action** with your real step.

## What is in it

| Node | Does |
|---|---|
| Configure me | Call Me number, sender name, request to approve |
| Ask by phone | AI Agent. Calls once with `call`, polls with `poll_result` while it rings, returns `approved`, `rejected` or `no_answer` and the transcript |
| Call Me MCP | MCP Client Tool on `https://serdaroztetik.com/aiphone/mcp`, limited to `call` and `poll_result` |
| Route by answer | One branch per decision |
| Text the question instead | Standalone MCP Client calling `text` when nobody answers, in the same thread on the phone |

No Call Me credential exists: the number is the only thing needed to reach the
phone, so treat it like a password.
