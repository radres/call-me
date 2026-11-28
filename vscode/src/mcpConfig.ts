// Reads and merges an editor's MCP config file. No vscode import here, so the
// node unit tests can load it directly.

import * as fs from "fs";
import * as path from "path";

export const SERVER_URL = "https://callmemcp.com/mcp";
export const SERVER_NAME = "call-me";

// URLs that already point at /call-me. serdaroztetik.com/aiphone/mcp is the
// older address of the same server and still answers.
const KNOWN_URLS = [SERVER_URL, "https://serdaroztetik.com/aiphone/mcp"];

/** How one editor wants a remote server written into its file. */
export interface EntryShape {
  /** Key that holds the URL: most editors use "url", a few use "serverUrl". */
  urlKey: "url" | "serverUrl";
  /** Extra fields some editors want next to the URL, e.g. {"type": "http"}. */
  extra?: Record<string, string>;
}

export type MergeResult =
  | { kind: "added"; text: string; key: string }
  | { kind: "present"; key: string }
  | { kind: "unreadable"; reason: string };

function normalise(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

function pointsAtCallMe(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  const known = KNOWN_URLS.map(normalise);
  return ["url", "serverUrl", "httpUrl"].some((k) => {
    const v = normalise(e[k]);
    return v !== undefined && known.includes(v);
  });
}

export function buildEntry(shape: EntryShape): Record<string, string> {
  return { ...(shape.extra ?? {}), [shape.urlKey]: SERVER_URL };
}

/**
 * Merge the /call-me server into the text of an MCP config file.
 * `text` is undefined or empty when the file does not exist yet.
 * Never drops or rewrites another server's entry, and refuses a file it
 * cannot parse as plain JSON rather than guessing.
 */
export function mergeServer(text: string | undefined, shape: EntryShape): MergeResult {
  let root: unknown = {};
  if (text !== undefined && text.trim() !== "") {
    try {
      root = JSON.parse(text);
    } catch (err) {
      return { kind: "unreadable", reason: `not plain JSON (${(err as Error).message})` };
    }
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { kind: "unreadable", reason: "the top level is not a JSON object" };
  }
  const obj = root as Record<string, unknown>;
  if (obj.mcpServers === undefined) obj.mcpServers = {};
  const servers = obj.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return { kind: "unreadable", reason: '"mcpServers" is not a JSON object' };
  }
  const map = servers as Record<string, unknown>;
  for (const [key, entry] of Object.entries(map)) {
    if (pointsAtCallMe(entry)) return { kind: "present", key };
  }
  // Keep someone else's "call-me" entry untouched: pick a free name instead.
  let key = SERVER_NAME;
  for (let i = 2; key in map; i++) key = i === 2 ? "callmemcp" : `callmemcp-${i}`;
  map[key] = buildEntry(shape);
  return { kind: "added", text: JSON.stringify(obj, null, 2) + "\n", key };
}

export function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** True when the file exists and already lists /call-me. */
export function alreadyConfigured(file: string): boolean {
  let text: string | undefined;
  try {
    text = readIfExists(file);
  } catch {
    return false;
  }
  if (text === undefined) return false;
  return mergeServer(text, { urlKey: "url" }).kind === "present";
}

/**
 * Write `text` to `file` without a half-written file ever being visible:
 * write a sibling temp file, keep the original's permissions, then rename.
 * New files are created private (0600) because MCP configs often hold other
 * servers' API keys.
 */
export function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    /* new file */
  }
  const tmp = `${file}.callme-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}
