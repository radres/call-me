#!/usr/bin/env node

// Disarms the answer waiter armed by the Stop hook.
//
// Runs on two events, both meaning "no phone call is warranted any more":
//   UserPromptSubmit — the human is at the keyboard and just answered.
//   SessionEnd       — the session is over; there is nobody left to hand an
//                      answer to, so waking a model to phone them is pointless.
//
// It prints NOTHING. A UserPromptSubmit hook's stdout is injected into the
// model's context, and this has nothing to say to the model. It only unlinks one
// file, and every failure path exits 0 silently.

import { clearWaiter, stateKey } from "../lib/callme-config.mjs";

main().catch(() => process.exit(0));

async function main() {
  const input = parseJson(await readStdin());
  if (!input) return;

  clearWaiter(
    stateKey({
      sessionId: input.session_id,
      projectDir: typeof input.cwd === "string" ? input.cwd : undefined,
    }),
  );
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    // No stdin (hook run by hand, or a host that pipes nothing) must not hang.
    const done = setTimeout(() => resolve(data), 2_000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        clearTimeout(done);
        resolve(data);
      }
    });
    process.stdin.on("end", () => {
      clearTimeout(done);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(done);
      resolve(data);
    });
  });
}

function parseJson(text) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
