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
import { dirname, join } from "node:path";

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
 * The key every per-session file in ~/.aiphone hangs off: the Claude session id
 * when the host provides one, else the project path.
 *
 * The Stop hook must pass the session id from its payload (a hook process is not
 * guaranteed to inherit CLAUDE_CODE_SESSION_ID); the monitor and the MCP server
 * get it from the env. Both must land on the SAME string or the hook arms a
 * waiter no monitor is watching.
 */
export function stateKey({ sessionId, projectDir } = {}) {
  const id = String(sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? "").replace(
    /[^A-Za-z0-9-]/g,
    "",
  );
  if (id) return id;
  const dir = projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return dir.replace(/[^A-Za-z0-9]+/g, "-");
}

/**
 * Has the human asked to be reminded in EVERY session, not just ones that have
 * already used Call Me? Off by default: the reminder is then scoped to sessions
 * that opted in by using the skill. Onboarding turns it on for humans who are
 * usually away from the keyboard (`callme remind on`), which is what makes the
 * backstop work in a session that would otherwise never mention Call Me.
 */
export function alwaysRemind() {
  return readConfig()?.always_remind === true;
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

// --- the answer waiter -----------------------------------------------------
//
// The Stop hook does not reach for the phone the moment a question is parked:
// the human may simply be at the keyboard about to type. It ARMS a waiter (this
// file) and lets the turn end, which is what gives them the grace window. The
// waiter monitor watches the arm file and, if the window closes with no answer,
// wakes the model so IT can dial. Hooks remind, models dial — arming keeps that
// rule intact while adding the wait the rule used to skip.

/** The armed waiter for one session: {armed_at, grace_s, question}. */
export function awaitPath(stateKey) {
  return join(stateDir(), `claude-await-${stateKey}.json`);
}

/** The waiter monitor's liveness heartbeat, so the hook knows if anyone is watching. */
export function waiterHeartbeatPath(stateKey) {
  return join(stateDir(), `claude-waiter-${stateKey}.json`);
}

/**
 * Is a waiter monitor watching this session right now? When it is not (monitors
 * unsupported, disabled, or still starting) the Stop hook must fall back to
 * reminding immediately — a grace period nobody is timing is just silence.
 */
export function waiterAlive(stateKey, maxAgeS = 45) {
  return stampFresh(waiterHeartbeatPath(stateKey), maxAgeS);
}

export function armWaiter(stateKey, { question = "", graceS } = {}) {
  try {
    writeJsonPrivate(awaitPath(stateKey), {
      armed_at: Date.now(),
      grace_s: Number.isFinite(graceS) ? graceS : answerGraceSeconds(),
      question: String(question || "").replace(/\s+/g, " ").trim().slice(0, 400),
    });
    return true;
  } catch {
    return false;
  }
}

export function readWaiter(stateKey) {
  const armed = readJson(awaitPath(stateKey));
  return Number.isFinite(armed?.armed_at) ? armed : null;
}

/** Disarm: the human answered, the session ended, or the turn parked nothing. */
export function clearWaiter(stateKey) {
  try {
    unlinkSync(awaitPath(stateKey));
    return true;
  } catch {
    return false;
  }
}

/**
 * How long the human gets to answer at the keyboard before the model is woken to
 * phone them. env override -> config.json (`callme grace`) -> 2 minutes.
 * 0 disables the wait, i.e. remind at the instant the turn ends.
 */
export function answerGraceSeconds() {
  const env = Number.parseInt(process.env.CALLME_ANSWER_GRACE ?? "", 10);
  if (Number.isFinite(env) && env >= 0) return env;
  const stored = readConfig()?.answer_grace_s;
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return 120;
}

// --- mtime-only stamps (shared by the hook and the waiter monitor) ----------

/** ~/.aiphone/hook-stamps/<name>-<stateKey> — the file's mtime IS the value. */
export function hookStampPath(name, stateKey) {
  return join(stateDir(), "hook-stamps", `${name}-${stateKey}`);
}

export function stampFresh(file, seconds) {
  try {
    return Date.now() - statSync(file).mtimeMs < seconds * 1000;
  } catch {
    return false;
  }
}

export function touchStamp(file) {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${new Date().toISOString()}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
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
      if (!/^claude-(session|monitor|channel|reach|await|waiter)-.*\.json$/.test(name)) continue;
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
