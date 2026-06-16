#!/usr/bin/env node
// UserPromptSubmit hook — inject pointers (not payloads) to relevant memory entries.
//
// Design (FIXED — see kickoff 2026-06-10):
//   • Read ~/.ai-loadout/index.json (refreshed by the freshness ritual in CLAUDE.md)
//   • matchLoadout(prompt, index) against it
//   • Emit AT MOST 5 entries as one-line pointers: "- <id> — <summary> → <path>"
//   • Total additionalContext kept ≤ ~200 tokens
//   • Below-threshold match (score < HOOK_MIN_SCORE) → emit nothing (silent)
//   • Always-record loaded events to ~/.ai-loadout/usage.jsonl (incl. score + reason)
//
// Switches (env):
//   • AI_LOADOUT_HOOK=off       → no-op exit 0
//   • AI_LOADOUT_HOOK=debug     → print why-silent + top near-misses to STDERR only
//                                 (never stdout; the suppressOutput / fail-silent
//                                 contract and the ≤200-token budget are untouched)
//   • AI_LOADOUT_MIN_SCORE=<n>  → override the score floor (default 0.3) for
//                                 calibration, without an edit + mirror→live cutover
// Latency budget: < 500 ms cold. Never blocks.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

if (process.env.AI_LOADOUT_HOOK === 'off') {
  process.exit(0);
}

const HOME = homedir();
const INDEX_PATH = resolve(HOME, '.ai-loadout', 'index.json');
const USAGE_PATH = resolve(HOME, '.ai-loadout', 'usage.jsonl');
const MAX_ENTRIES = 5;
const MAX_LINE_CHARS = 180;
// Minimum match score for a DOMAIN entry to be injected. Core entries (score 1.0)
// always pass. Calibrated 2026-06-16 against the live 336-entry index: observed
// incidental single-keyword noise tops out at ~0.25, genuine topical matches begin
// ~0.33+, so 0.3 is the "confident match" floor that delivers the design's
// "below-threshold → emit nothing". Override per-run with AI_LOADOUT_MIN_SCORE for
// calibration without an edit + cutover. Recall on keyword-rich entries (e.g. game
// canon) is a separate Phase-2 keyword-curation concern, not this floor's job.
const _envMin = Number(process.env.AI_LOADOUT_MIN_SCORE);
const HOOK_MIN_SCORE = Number.isFinite(_envMin) ? _envMin : 0.3;

// Debug diagnostics → STDERR only (never stdout, so suppressOutput + fail-silent
// are preserved). Answers "why was the hook silent on a prompt I expected a hit for".
const DEBUG = process.env.AI_LOADOUT_HOOK === 'debug';
function debug(msg) {
  if (!DEBUG) return;
  try { process.stderr.write('[loadout-hook] ' + msg + '\n'); } catch { /* ignore */ }
}

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeExit(code) {
  try { process.exit(code); } catch { /* ignore */ }
}

function clip(s, n) {
  if (!s) return '';
  s = String(s);
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

async function main() {
  if (!existsSync(INDEX_PATH)) { debug('silent: no index at ' + INDEX_PATH); safeExit(0); return; }

  const stdin = readStdinSync();
  let payload;
  try { payload = JSON.parse(stdin); } catch { debug('silent: stdin is not valid JSON'); safeExit(0); return; }
  const prompt = (payload.prompt || payload.user_prompt || payload.message || '').toString();
  if (!prompt.trim()) { debug('silent: empty prompt'); safeExit(0); return; }

  let index;
  try { index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')); } catch { debug('silent: index is not valid JSON'); safeExit(0); return; }
  // Shape guard: a valid-but-wrong index would otherwise throw inside matchLoadout
  // and look identical to "no index". Surface the difference in debug mode.
  if (!index || !Array.isArray(index.entries)) { debug('silent: index parsed but has no entries[] array (malformed)'); safeExit(0); return; }

  let matchLoadout;
  try {
    ({ matchLoadout } = await import('@mcptoolshop/ai-loadout'));
  } catch {
    debug('silent: could not import @mcptoolshop/ai-loadout');
    safeExit(0); return;
  }

  let results;
  try { results = matchLoadout(prompt, index); } catch { debug('silent: matchLoadout threw'); safeExit(0); return; }
  const eligible = (results || []).filter(r => r && r.entry && r.entry.priority !== 'manual');
  const top = eligible.filter(r => r.score >= HOOK_MIN_SCORE).slice(0, MAX_ENTRIES);
  if (top.length === 0) {
    if (DEBUG) {
      const near = eligible.slice(0, 3).map(r => `${(r.score ?? 0).toFixed(3)} ${r.entry.id} (${r.reason || ''})`);
      debug(`silent: no match ≥ floor ${HOOK_MIN_SCORE}. top near-misses: ` + (near.length ? near.join(' | ') : '(none)'));
    }
    safeExit(0); return;
  }

  const lines = top.map(r => {
    const id  = r.entry.id || '(unnamed)';
    const sum = r.entry.summary || '';
    const pth = r.entry.path || '';
    return clip(`- ${id} — ${sum} → ${pth}`, MAX_LINE_CHARS);
  });

  const additionalContext =
    '[loadout-hook] Memory entries relevant to this prompt (open the file pointer before acting, do not paraphrase from the summary):\n' +
    lines.join('\n');

  // Record usage (best-effort; never block). Records score + reason so the floor can
  // be re-calibrated from field data (ai-loadout usage/dead), and a taskHashSource
  // marker so ungroupable (timestamp-fallback) events aren't counted as distinct tasks.
  try {
    if (!existsSync(dirname(USAGE_PATH))) mkdirSync(dirname(USAGE_PATH), { recursive: true });
    const ts = new Date().toISOString();
    const sessionId = (payload.session_id || '').toString();
    const promptId = (payload.prompt_id || '').toString();
    let taskHash, taskHashSource;
    if (sessionId) { taskHash = sessionId.slice(0, 12); taskHashSource = 'session'; }
    else if (promptId) { taskHash = promptId.slice(0, 12); taskHashSource = 'prompt'; }
    else { taskHash = ts.replace(/[-:.TZ]/g, '').slice(0, 14); taskHashSource = 'timestamp'; }
    const events = top.map(r => JSON.stringify({
      timestamp: ts,
      taskHash,
      taskHashSource,
      entryId: r.entry.id,
      trigger: 'UserPromptSubmit',
      mode: r.mode || 'lazy',
      score: typeof r.score === 'number' ? r.score : null,
      reason: r.reason || '',
      tokensEst: r.entry.tokens_est || 0
    })).join('\n') + '\n';
    appendFileSync(USAGE_PATH, events, 'utf8');
  } catch { /* swallow */ }

  if (DEBUG) debug(`injected ${top.length} pointer(s): ` + top.map(r => `${r.entry.id}@${(r.score ?? 0).toFixed(3)}`).join(', '));

  process.stdout.write(JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  }));
  safeExit(0);
}

main().catch(() => safeExit(0));
