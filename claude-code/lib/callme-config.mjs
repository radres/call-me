// Shared Call Me config/state helpers for the Claude Code plugin.
//
// The paired human's number has ONE home: ~/.aiphone/config.json. Every entry
// point (this plugin's MCP server, its monitor, and the `callme` CLI) reads it
// through the same precedence rules, so pairing once from any of them teaches
// all the others — including sessions that are already running.
//
// Imported by channel/channel.mjs (esbuild inlines it into dist/channel.mjs)
// and by monitors/inbound.mjs (plain runtime import; lib/ ships in the plugin).

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_VERSION = 1;

export function normalizeNumber(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidNumber(value) {
  return /^\d{10}$/.test(normalizeNumber(value));
}

/** 584-158-6160 — the grouping the iPhone app shows, so it reads back the same. */
export function displayNumber(value) {
  const n = normalizeNumber(value);
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}` : n;
}

export function stateDir() {
  return process.env.AIPHONE_STATE_DIR || join(homedir(), ".aiphone");
}

export function configPath() {
  return join(stateDir(), "config.json");
}

/**
 * Per-session state file key. channel.mjs and inbound.mjs MUST agree on this or
 * they create two sessions (two threads on the phone) for one Claude.
 */
export function stateFileFor({ projectDir } = {}) {
  const claudeSessionId = (process.env.CLAUDE_CODE_SESSION_ID || "").replace(/[^A-Za-z0-9-]/g, "");
  if (claudeSessionId) return join(stateDir(), `claude-session-${claudeSessionId}.json`);
  const dir = projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return join(stateDir(), `claude-channel-${dir.replace(/[^A-Za-z0-9]+/g, "-")}.json`);
}

/**
 * Where a session records that it just reached the human. The Stop hook reads it
 * to stay quiet when the model already texted or called during the same turn.
 * Keyed the same way as stateFileFor(), so the hook can derive it from the hook
 * payload's session_id without inheriting CLAUDE_CODE_SESSION_ID.
 */
export function reachStampPath(stateKey) {
  return join(stateDir(), `claude-reach-${stateKey}.json`);
}

/** Note that the human was just contacted, for reachStampPath() readers. */
export function markReachedOut(stateKey, kind) {
  try {
    writeJsonPrivate(reachStampPath(stateKey), { at: Date.now(), kind });
  } catch {
    // Best effort: a missed stamp only costs a redundant reminder.
  }
}

/** Write JSON atomically at 0600. A writeFileSync mode arg won't fix an existing file. */
export function writeJsonPrivate(file, data) {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readConfig() {
  const cfg = readJson(configPath());
  return cfg && typeof cfg === "object" ? cfg : null;
}

export function writeConfig(patch) {
  const cfg = readConfig() || { version: CONFIG_VERSION };
  const next = { ...cfg, ...patch, version: CONFIG_VERSION, updated_at: new Date().toISOString() };
  if (next.user_number) next.display = displayNumber(next.user_number);
  delete next.api; // product rule: no API base ever lands in user config
  writeJsonPrivate(configPath(), next);
  return next;
}

/**
 * Resolve the paired human's number.
 *
 *   1. CALLME_USER_NUMBER env — hard override, never persisted
 *   2. config.json, after reconciling the plugin-UI seed
 *      (no config -> seed it; seed changed -> the user edited /plugin, adopt it)
 *   3. this session's own legacy state file -> promoted into config.json
 *
 * Returns { number, source } with number === "" when unpaired.
 */
export function resolveUserNumber({ projectDir } = {}) {
  const override = normalizeNumber(process.env.CALLME_USER_NUMBER || "");
  if (isValidNumber(override)) return { number: override, source: "env" };

  const seed = normalizeNumber(
    process.env.CLAUDE_PLUGIN_OPTION_user_number ||
      process.env.CLAUDE_PLUGIN_OPTION_USER_NUMBER ||
      process.env.AIPHONE_USER_NUMBER ||
      "",
  );
  const cfg = readConfig();
  const stored = normalizeNumber(cfg?.user_number || "");

  if (isValidNumber(seed)) {
    if (!isValidNumber(stored)) {
      writeConfig({ user_number: seed, source: "plugin-config", seen_plugin_config: seed });
      return { number: seed, source: "plugin-config" };
    }
    if (seed !== normalizeNumber(cfg.seen_plugin_config || "")) {
      // The plugin UI value changed since we last looked: the human edited it.
      writeConfig({ user_number: seed, source: "plugin-config", seen_plugin_config: seed });
      return { number: seed, source: "plugin-config" };
    }
  }
  if (isValidNumber(stored)) return { number: stored, source: cfg.source || "config" };

  const legacy = normalizeNumber(readJson(stateFileFor({ projectDir }))?.userNumber || "");
  if (isValidNumber(legacy)) {
    writeConfig({ user_number: legacy, source: "legacy-session" });
    return { number: legacy, source: "legacy-session" };
  }
  return { number: "", source: "unpaired" };
}

let cached = { at: 0, value: null };

/** resolveUserNumber() with a 2s cache — safe to call on every send. */
export function currentUserNumber(options) {
  const now = Date.now();
  if (cached.value && now - cached.at < 2_000) return cached.value;
  cached = { at: now, value: resolveUserNumber(options) };
  return cached.value;
}

export function forgetCachedNumber() {
  cached = { at: 0, value: null };
}

export const NOT_PAIRED_HINT =
  "Not paired with a phone yet. Run the setup tool and show the human its output verbatim, " +
  "then pair with the 10-digit number they read back from the Call Me app. Never guess a number — " +
  "it is a credential and a wrong one rings a stranger.";

/** chmod ~/.aiphone to 0700 and every *.json inside it to 0600. */
export function hardenModes() {
  const dir = stateDir();
  try {
    chmodSync(dir, 0o700);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        chmodSync(join(dir, name), 0o600);
      } catch {}
    }
  } catch {}
}

/** Delete per-session state files older than `days` (default 30). */
export function pruneStaleState({ days = 30 } = {}) {
  const cutoff = Date.now() - days * 86_400_000;
  let removed = 0;
  try {
    for (const name of readdirSync(stateDir())) {
      if (!/^claude-(session|monitor|channel|reach)-.*\.json$/.test(name)) continue;
      const file = join(stateDir(), name);
      try {
        if (statSync(file).mtimeMs < cutoff) {
          unlinkSync(file);
          removed += 1;
        }
      } catch {}
    }
  } catch {}
  return removed;
}
