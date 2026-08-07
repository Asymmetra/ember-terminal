/**
 * localStorage persistence for observability page state.
 *
 * What's persisted:
 *   - Per-source recent payload tail (capped — see HISTORY_LIMIT)
 *   - Per-source cumulative stats (count, errorCount, lastUpdateAtMs proxy)
 *   - User preferences (enabled categories, paused state, selected source)
 *
 * What's NOT persisted (intentionally — kept ephemeral in-memory only):
 *   - Per-message inter-arrival samples (large, low value to persist)
 *   - WebSocket connection state (recreated on mount)
 *
 * Budget: cap total observability-related storage at ~3MB so we don't
 * blow up the 5MB browser-tab quota. We trim recentPayloads first when
 * over budget. Encoded as a single JSON document under one key for
 * atomicity.
 */

import type { DataSource } from "./types";

const STORAGE_KEY = "ember-observability-v1";
const MAX_BYTES = 3 * 1024 * 1024; // 3MB soft cap

export interface PersistedSourceSlice {
  id: string;
  count: number;
  errorCount: number;
  recentPayloads: Array<{ tMs: number; payload: unknown }>;
}

export interface PersistedState {
  version: 1;
  savedAt: number; // ms since epoch
  sources: Record<string, PersistedSourceSlice>;
  preferences: {
    paused: boolean;
    expandedCategories: Record<string, boolean>;
    selectedSourceId: string | null;
    snippetLanguage: string;
  };
}

const DEFAULT_PREFS: PersistedState["preferences"] = {
  paused: false,
  expandedCategories: {
    "phoenix-ws": true,
    "phoenix-rest": true,
    "ember-ws": true,
    "ember-rest": true,
  },
  selectedSourceId: null,
  snippetLanguage: "ts",
};

export function loadPersisted(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadPreferences(): PersistedState["preferences"] {
  const p = loadPersisted();
  return { ...DEFAULT_PREFS, ...(p?.preferences ?? {}) };
}

export function savePersisted(
  sources: Record<string, DataSource>,
  preferences: PersistedState["preferences"],
): void {
  if (typeof window === "undefined") return;
  const slices: Record<string, PersistedSourceSlice> = {};
  for (const [id, src] of Object.entries(sources)) {
    slices[id] = {
      id,
      count: src.stats.count,
      errorCount: src.stats.errorCount,
      recentPayloads: src.recentPayloads,
    };
  }
  const doc: PersistedState = {
    version: 1,
    savedAt: Date.now(),
    sources: slices,
    preferences,
  };

  let json = JSON.stringify(doc);
  // If over budget, repeatedly trim the largest source's payload history
  // until we're under the cap or there's nothing left to trim.
  while (json.length > MAX_BYTES) {
    const biggest = Object.values(doc.sources)
      .filter((s) => s.recentPayloads.length > 1)
      .sort((a, b) => b.recentPayloads.length - a.recentPayloads.length)[0];
    if (!biggest) break;
    // Drop oldest half.
    biggest.recentPayloads = biggest.recentPayloads.slice(
      Math.ceil(biggest.recentPayloads.length / 2),
    );
    json = JSON.stringify(doc);
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Quota exceeded: best-effort drop a single key and move on.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }
}
