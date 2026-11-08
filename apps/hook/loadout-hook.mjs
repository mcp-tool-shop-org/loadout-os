#!/usr/bin/env node
// UserPromptSubmit hook — inject pointers (not payloads) to relevant memory entries.
//
// Design (FIXED — see kickoff 2026-06-10, updated 2026-11-08 for project layer):
//   • Resolve ~/.ai-loadout/index.json (global) and <projectRoot>/.claude/loadout/index.json (project)
//   • Walk up from payload.cwd (falling back to process.cwd()) for the project index,
//     with AI_LOADOUT_PROJECT_INDEX=<path> taking precedence
//   • Merge global and project layers (project wins on an id collision)
//   • matchLoadout(prompt, merged) against the merged index
//   • Exclude manual entries and session-start injected boards (metadata.loadout_inject === "session-start")
//   • Emit AT MOST 5 entries in total, giving each layer a fair share (up to 3 per layer, then fill)
//     and preferring sub-index entries over top-level MEMORY.md entries within the project layer
//   • Below-threshold match (score < HOOK_MIN_SCORE) → emit nothing (silent)
//   • Always-record loaded events to ~/.ai-loadout/usage.jsonl (incl. score, reason, and layer)
//
// Switches (env):
//   • AI_LOADOUT_HOOK=off              → no-op exit 0
//   • AI_LOADOUT_HOOK=debug            → print why-silent + top near-misses to STDERR only
//   • AI_LOADOUT_MIN_SCORE=<n>         → override the score floor (default 0.5)
//   • AI_LOADOUT_PROJECT_INDEX=<path>  → explicit project index.json path
// Latency budget: < 500 ms cold. Never blocks.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

if (process.env.AI_LOADOUT_HOOK === 'off') {
  process.exit(0);
}

const HOME = homedir();
const GLOBAL_DIR = resolve(HOME, '.ai-loadout');
const INDEX_PATH = resolve(GLOBAL_DIR, 'index.json');
const USAGE_PATH = resolve(GLOBAL_DIR, 'usage.jsonl');
const MAX_ENTRIES = 5;
const FAIR_SHARE_PER_LAYER = 3;
const MAX_LINE_CHARS = 180;
// Minimum match score for a DOMAIN entry to be injected. Core entries (score 1.0)
// always pass. Re-calibrated 2026-06-16 for the NEW recall-aware scoring in the
// inlined kernel matcher: score = max(coverage, matched/ABSOLUTE_K=5) + patternBonus.
const _envMin = Number(process.env.AI_LOADOUT_MIN_SCORE);
const HOOK_MIN_SCORE = Number.isFinite(_envMin) ? _envMin : 0.5;

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

function isSessionStartInjected(entry) {
  if (!entry || !entry.metadata || typeof entry.metadata !== 'object') return false;
  return entry.metadata.loadout_inject === 'session-start';
}

function isSubindexEntry(entry) {
  if (!entry) return false;
  if (entry.subindex === true) return true;
  if (entry.metadata && typeof entry.metadata === 'object') {
    if (entry.metadata.subindex === true || entry.metadata.subindex === 'true') return true;
  }
  return false;
}

function formatPointerLine(r) {
  const id  = r.entry.id || '(unnamed)';
  const sum = r.entry.summary || '';
  const pth = r.entry.path || '';
  return clip(`- ${id} — ${sum} → ${pth}`, MAX_LINE_CHARS);
}

/**
 * Select at most MAX_ENTRIES across global and project layers with fair share (F-22):
 * - Within the project layer, prefer sub-index entries over top-level MEMORY.md entries
 *   so auto-loaded MEMORY.md entries do not crowd out sub-index entries.
 * - Take up to FAIR_SHARE_PER_LAYER (3) from each layer first, then fill any remaining
 *   slots up to MAX_ENTRIES (5) from whichever layer still has candidates.
 */
function selectTopEntries(aboveFloor, provenance) {
  const getLayer = (r) => {
    const p = provenance && provenance[r.entry.id];
    return p === 'project' ? 'project' : 'global';
  };

  const globalCandidates = aboveFloor.filter(r => getLayer(r) === 'global');
  const projectCandidates = aboveFloor.filter(r => getLayer(r) === 'project');

  // When only global candidates exist, preserve main's exact order and slicing.
  if (projectCandidates.length === 0) {
    return globalCandidates.slice(0, MAX_ENTRIES);
  }

  // Within project candidates, prefer sub-index entries over top-level MEMORY.md entries
  // among domain matches so sub-index entries aren't starved by already-loaded MEMORY.md bullets (F-22).
  const sortedProject = [...projectCandidates].sort((a, b) => {
    const aCore = a.entry.priority === 'core' ? 1 : 0;
    const bCore = b.entry.priority === 'core' ? 1 : 0;
    if (bCore !== aCore) return bCore - aCore;
    const aSub = isSubindexEntry(a.entry) ? 1 : 0;
    const bSub = isSubindexEntry(b.entry) ? 1 : 0;
    if (bSub !== aSub) return bSub - aSub;
    if (b.score !== a.score) return b.score - a.score;
    return (a.entry.tokens_est || 0) - (b.entry.tokens_est || 0);
  });

  if (globalCandidates.length === 0) {
    return sortedProject.slice(0, MAX_ENTRIES);
  }

  // Fair share: up to FAIR_SHARE_PER_LAYER (3) from project and global if both have > 2,
  // capped at MAX_ENTRIES (5). Specifically: give each layer up to min(2, initial) when both
  // exceed 2? Wait: if project has 3 and global has 3, 3 + 3 = 6 > 5.
  // Let's take up to 3 from project and up to 2 from global (or up to 2 from each, then 5th by score),
  // or take up to 3 from each layer in round-robin / score order so neither layer can take > 3
  // when the other layer has at least 2 entries!
  // Wait: "Give each layer a fair share (for example up to 3 per layer, then fill)"
  const selected = [];
  const usedIds = new Set();

  // First pass: neither layer may exceed FAIR_SHARE_PER_LAYER (3) while the other has unselected items.
  // To guarantee neither layer starves the other (even if global has 5 core entries at score 1.0
  // and project has 3 domain entries at score 0.6), reserve up to min(2, count) or up to 3 per layer:
  // If we take up to 3 from project first (or interleave up to 3 per layer):
  const projInitial = sortedProject.slice(0, FAIR_SHARE_PER_LAYER);
  const globInitial = globalCandidates.slice(0, FAIR_SHARE_PER_LAYER);

  // Interleave project and global initial shares so if both have 3 (total 6 > 5),
  // project gets up to 3 and global gets up to 2 (or highest score wins the 5th slot, while
  // both are guaranteed at least min(2, count) and at most 3 before filling).
  const maxInitial = Math.max(projInitial.length, globInitial.length);
  for (let i = 0; i < maxInitial && selected.length < MAX_ENTRIES; i++) {
    if (i < projInitial.length && selected.length < MAX_ENTRIES) {
      selected.push(projInitial[i]);
      usedIds.add(projInitial[i].entry.id);
    }
    if (i < globInitial.length && selected.length < MAX_ENTRIES) {
      selected.push(globInitial[i]);
      usedIds.add(globInitial[i].entry.id);
    }
  }

  // Second pass: fill remaining slots up to MAX_ENTRIES from whichever layer still has entries.
  if (selected.length < MAX_ENTRIES) {
    const remaining = [...sortedProject, ...globalCandidates].filter(r => !usedIds.has(r.entry.id));
    for (const r of remaining) {
      if (selected.length >= MAX_ENTRIES) break;
      selected.push(r);
      usedIds.add(r.entry.id);
    }
  }

  return selected;
}

async function main() {
  const stdin = readStdinSync();
  let payload;
  try { payload = JSON.parse(stdin); } catch { debug('silent: stdin is not valid JSON'); safeExit(0); return; }
  const prompt = (payload.prompt || payload.user_prompt || payload.message || '').toString();
  if (!prompt.trim()) { debug('silent: empty prompt'); safeExit(0); return; }

  const startCwd = (payload.cwd && typeof payload.cwd === 'string' && payload.cwd.trim())
    ? payload.cwd.trim()
    : process.cwd();
  const envProjectIndex = (process.env.AI_LOADOUT_PROJECT_INDEX || '').trim();

  let matchLoadout, resolveLoadout;
  try {
    ({ matchLoadout, resolveLoadout } = await import('@mcptoolshop/ai-loadout'));
  } catch {
    debug('silent: could not import @mcptoolshop/ai-loadout');
    safeExit(0); return;
  }

  let resolved;
  try {
    resolved = resolveLoadout({
      globalDir: GLOBAL_DIR,
      projectRoot: startCwd,
      projectIndexPath: envProjectIndex || undefined,
      walkUpProject: !envProjectIndex,
    });
  } catch {
    debug('silent: resolveLoadout threw');
    safeExit(0); return;
  }

  if (!resolved || !Array.isArray(resolved.layers) || resolved.layers.length === 0) {
    if (DEBUG && resolved && Array.isArray(resolved.searched)) {
      const malf = resolved.searched.filter(s => s.malformed);
      if (malf.length > 0) {
        debug('silent: malformed index(es): ' + malf.map(m => `${m.name} (${m.path}): ${m.error}`).join('; '));
      } else {
        debug('silent: no index found at ' + INDEX_PATH + ' or project layer');
      }
    }
    safeExit(0); return;
  }

  if (DEBUG && Array.isArray(resolved.searched)) {
    for (const s of resolved.searched) {
      if (s.malformed) {
        debug(`warning: malformed ${s.name} index at ${s.path}: ${s.error}`);
      }
    }
  }

  const index = resolved.merged;
  const provenance = index.provenance || {};

  let results;
  try { results = matchLoadout(prompt, index); } catch { debug('silent: matchLoadout threw'); safeExit(0); return; }

  // F-20: exclude manual entries AND entries injected in full at session-start (e.g. BOARD.md)
  // so session-start boards do not consume one of the 5 UserPromptSubmit slots on every prompt.
  const eligible = (results || []).filter(
    r => r && r.entry && r.entry.priority !== 'manual' && !isSessionStartInjected(r.entry)
  );
  const aboveFloor = eligible.filter(r => r.score >= HOOK_MIN_SCORE);
  const top = selectTopEntries(aboveFloor, provenance);

  if (top.length === 0) {
    if (DEBUG) {
      const near = eligible.slice(0, 3).map(r => `${(r.score ?? 0).toFixed(3)} ${r.entry.id} (${r.reason || ''})`);
      debug(`silent: no match ≥ floor ${HOOK_MIN_SCORE}. top near-misses: ` + (near.length ? near.join(' | ') : '(none)'));
    }
    safeExit(0); return;
  }

  const getLayer = (r) => (provenance[r.entry.id] === 'project' ? 'project' : 'global');
  const globalTop = top.filter(r => getLayer(r) === 'global');
  const projectTop = top.filter(r => getLayer(r) === 'project');

  const sections = [];
  if (globalTop.length > 0) {
    const lines = globalTop.map(formatPointerLine);
    sections.push(
      '[loadout-hook] Memory entries relevant to this prompt (open the file pointer before acting, do not paraphrase from the summary):\n' +
      lines.join('\n')
    );
  }
  if (projectTop.length > 0) {
    const lines = projectTop.map(formatPointerLine);
    sections.push(
      '[loadout-hook] Project memory entries relevant to this prompt (open the file pointer before acting, do not paraphrase from the summary):\n' +
      lines.join('\n')
    );
  }

  const additionalContext = sections.join('\n\n');

  // Record usage (best-effort; never block). Always writes to the real ~/.ai-loadout/usage.jsonl
  // with layer: "global" | "project" (F-08).
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
      tokensEst: r.entry.tokens_est || 0,
      layer: getLayer(r)
    })).join('\n') + '\n';
    appendFileSync(USAGE_PATH, events, 'utf8');
  } catch { /* swallow */ }

  if (DEBUG) debug(`injected ${top.length} pointer(s): ` + top.map(r => `${r.entry.id}[${getLayer(r)}]@${(r.score ?? 0).toFixed(3)}`).join(', '));

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
