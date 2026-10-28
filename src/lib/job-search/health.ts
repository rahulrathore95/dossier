import { createHash } from "node:crypto";

import type { JobSearchProblem } from "./errors";
import type { JobSource } from "./search";

// How each job source has been answering lately (this fork): a source that
// just failed is rested for a while rather than asked again on every search,
// which spends nothing and makes searches no slower. Kept in memory, like
// the answer cache (cache.ts): one server, and a restart forgets — which
// only means a source gets one fresh try. A source whose key was refused
// rests until its key changes.

/** How long a source rests after each kind of failure. A refused key rests until the key changes (KEY_REST_MS is the longest it waits even then). */
export const REST_MS: Partial<Record<JobSearchProblem, number>> = {
  quota: 60 * 60_000,
  unavailable: 10 * 60_000,
  changed: 30 * 60_000,
};
const KEY_REST_MS = 24 * 60 * 60_000;

export type SourceHealth = {
  /** The last failure, while the source rests; null once it answers again. */
  problem: JobSearchProblem | null;
  message: string;
  /** When it last failed or answered, as ISO. */
  at: string;
  /** Resting until then, as ISO; null when it isn't. */
  until: string | null;
  /** Failures in a row. */
  failures: number;
  /** A fingerprint of the credentials it failed with, so a new key ends the rest. */
  credentials: string;
};

const store: Map<JobSource, SourceHealth> = ((globalThis as { __dossierJobSourceHealth?: Map<JobSource, SourceHealth> }).__dossierJobSourceHealth ??= new Map());

/** A one-way fingerprint of the credentials: never the key itself. */
export const fingerprint = (credentials: unknown) => createHash("sha256").update(JSON.stringify(credentials)).digest("hex").slice(0, 16);

export function recordSuccess(source: JobSource, now = new Date()): void {
  store.set(source, { problem: null, message: "", at: now.toISOString(), until: null, failures: 0, credentials: "" });
}

export function recordFailure(source: JobSource, problem: JobSearchProblem, message: string, credentials: unknown, now = new Date()): void {
  const failures = (store.get(source)?.failures ?? 0) + 1;
  // A source that doesn't cover the country isn't unhealthy: it's just not asked for that country.
  const rest = problem === "key" ? KEY_REST_MS : problem === "country" ? 0 : (REST_MS[problem] ?? 0);
  store.set(source, {
    problem,
    message,
    at: now.toISOString(),
    until: rest > 0 ? new Date(now.getTime() + rest).toISOString() : null,
    failures,
    credentials: fingerprint(credentials),
  });
}

/** Why the source is resting, or null when it may be asked: the rest is over, or its key changed since it failed. */
export function restingReason(source: JobSource, credentials: unknown, now = new Date()): { message: string; until: string } | null {
  const health = store.get(source);
  if (!health?.until || Date.parse(health.until) <= now.getTime()) return null;
  if (health.credentials !== fingerprint(credentials)) return null;
  return { message: health.message, until: health.until };
}

/** Every source's health, for Settings → Job search. */
export function sourceHealth(): Partial<Record<JobSource, SourceHealth>> {
  return Object.fromEntries(store);
}

export function clearSourceHealth(): void {
  store.clear();
}
