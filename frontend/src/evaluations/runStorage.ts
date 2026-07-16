import { z } from "zod";

const STORAGE_KEY_PREFIX = "evidence-desk:evaluation-run-ids:v2";
const MAX_RUN_IDS = 50;
const runIdSchema = z.string().uuid();

export type RunStorageScope = {
  tenant_id: string;
  user_id: string;
  dataset_id: string;
};

function storageKey(scope: RunStorageScope): string | null {
  if (!scope.tenant_id || !scope.user_id || !scope.dataset_id) return null;
  return [
    STORAGE_KEY_PREFIX,
    encodeURIComponent(scope.tenant_id),
    encodeURIComponent(scope.user_id),
    encodeURIComponent(scope.dataset_id),
  ].join(":");
}

export function listRunIds(scope: RunStorageScope): string[] {
  const key = storageKey(scope);
  if (!key) return [];
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];

    const runIds: string[] = [];
    for (const item of value) {
      const parsed = runIdSchema.safeParse(item);
      if (parsed.success && !runIds.includes(parsed.data)) {
        runIds.push(parsed.data);
      }
      if (runIds.length === MAX_RUN_IDS) break;
    }
    return runIds;
  } catch {
    return [];
  }
}

export function rememberRunId(scope: RunStorageScope, runId: string): string[] {
  const parsed = runIdSchema.safeParse(runId);
  if (!parsed.success) return listRunIds(scope);

  const next = [
    parsed.data,
    ...listRunIds(scope).filter((item) => item !== parsed.data),
  ].slice(0, MAX_RUN_IDS);
  const key = storageKey(scope);
  if (!key) return [];
  try {
    window.sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Evaluation run history is optional and remains session-only.
  }
  return next;
}

export function forgetRunId(scope: RunStorageScope, runId: string): string[] {
  const next = listRunIds(scope).filter((item) => item !== runId);
  const key = storageKey(scope);
  if (!key) return [];
  try {
    window.sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // ignore unavailable session storage
  }
  return next;
}
