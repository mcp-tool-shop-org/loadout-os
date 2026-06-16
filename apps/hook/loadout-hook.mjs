#!/usr/bin/env node
// UserPromptSubmit hook — inject pointers (not payloads) to relevant memory entries.
//
// Design (FIXED — see kickoff 2026-06-10):
//   • Read ~/.ai-loadout/index.json (refreshed by the freshness ritual in CLAUDE.md)
//   • matchLoadout(prompt, index) against it
//   • Emit AT MOST 5 entries as one-line pointers: "- <id> — <summary> → <path>"
//   • Total additionalContext kept ≤ ~200 tokens
//   • Below-threshold match (score < HOOK_MIN_SCORE) → emit nothing (silent)
//   • Always-record loaded events to ~/.ai-loadout/usage.jsonl
//
// Off-switch: AI_LOADOUT_HOOK=off  no-op exit 0.
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
// "below-threshold → emit nothing". Recall on keyword-rich entries (e.g. game
// canon) is a separate Phase-2 keyword-curation concern, not this floor's job.
const HOOK_MIN_SCORE = 0.3;

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
  if (!existsSync(INDEX_PATH)) { safeExit(0); return; }

  const stdin = readStdinSync();
  let payload;
  try { payload = JSON.parse(stdin); } catch { safeExit(0); return; }
  const prompt = (payload.prompt || payload.user_prompt || payload.message || '').toString();
  if (!prompt.trim()) { safeExit(0); return; }

  let index;
  try { index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')); } catch { safeExit(0); return; }

  let matchLoadout;
  try {
    ({ matchLoadout } = await import('@mcptoolshop/ai-loadout'));
  } catch {
    safeExit(0); return;
  }

  let results;
  try { results = matchLoadout(prompt, index); } catch { safeExit(0); return; }
  const top = (results || [])
    .filter(r => r && r.entry && r.entry.priority !== 'manual' && r.score >= HOOK_MIN_SCORE)
    .slice(0, MAX_ENTRIES);
  if (top.length === 0) { safeExit(0); return; }

  const lines = top.map(r => {
    const id  = r.entry.id || '(unnamed)';
    const sum = r.entry.summary || '';
    const pth = r.entry.path || '';
    return clip(`- ${id} — ${sum} → ${pth}`, MAX_LINE_CHARS);
  });

  const additionalContext =
    '[loadout-hook] Memory entries relevant to this prompt (open the file pointer before acting, do not paraphrase from the summary):\n' +
    lines.join('\n');

  // Record usage (best-effort; never block)
  try {
    if (!existsSync(dirname(USAGE_PATH))) mkdirSync(dirname(USAGE_PATH), { recursive: true });
    const ts = new Date().toISOString();
    const taskHash = (payload.prompt_id || payload.session_id || '').toString().slice(0, 12) || ts.replace(/[-:.TZ]/g, '').slice(0, 14);
    const events = top.map(r => JSON.stringify({
      timestamp: ts,
      taskHash,
      entryId: r.entry.id,
      trigger: 'UserPromptSubmit',
      mode: r.mode || 'lazy',
      tokensEst: r.entry.tokens_est || 0
    })).join('\n') + '\n';
    appendFileSync(USAGE_PATH, events, 'utf8');
  } catch { /* swallow */ }

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
