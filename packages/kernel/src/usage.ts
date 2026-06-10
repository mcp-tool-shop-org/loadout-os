/**
 * Usage event tracking.
 *
 * Append-only local log of which payloads get loaded.
 * Never networked. Never creepy. One line per event in JSONL.
 *
 * This is the only module in ai-loadout that does I/O.
 */

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import type { UsageEvent } from "./types.js";

/**
 * Append a usage event to a JSONL file.
 */
export function recordUsage(event: UsageEvent, filePath: string): void {
  appendFileSync(filePath, JSON.stringify(event) + "\n");
}

/**
 * Read all usage events from a JSONL file.
 * Silently skips malformed lines.
 */
export function readUsage(filePath: string): UsageEvent[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf-8");
  const events: UsageEvent[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as UsageEvent);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Summary of usage events grouped by entry ID.
 */
export interface UsageSummary {
  entryId: string;
  loadCount: number;
  totalTokens: number;
  lastLoaded: string;       // ISO 8601
  triggers: string[];       // unique triggers that caused loads
  modes: Set<string>;       // unique load modes used
}

/**
 * Summarize usage events by entry ID.
 */
export function summarizeUsage(events: UsageEvent[]): UsageSummary[] {
  const map = new Map<string, {
    loadCount: number;
    totalTokens: number;
    lastLoaded: string;
    triggers: Set<string>;
    modes: Set<string>;
  }>();

  for (const event of events) {
    const existing = map.get(event.entryId);
    if (existing) {
      existing.loadCount++;
      existing.totalTokens += event.tokensEst;
      if (event.timestamp > existing.lastLoaded) {
        existing.lastLoaded = event.timestamp;
      }
      existing.triggers.add(event.trigger);
      existing.modes.add(event.mode);
    } else {
      map.set(event.entryId, {
        loadCount: 1,
        totalTokens: event.tokensEst,
        lastLoaded: event.timestamp,
        triggers: new Set([event.trigger]),
        modes: new Set([event.mode]),
      });
    }
  }

  return [...map.entries()]
    .map(([entryId, data]) => ({
      entryId,
      loadCount: data.loadCount,
      totalTokens: data.totalTokens,
      lastLoaded: data.lastLoaded,
      triggers: [...data.triggers],
      modes: data.modes,
    }))
    .sort((a, b) => b.loadCount - a.loadCount);
}
