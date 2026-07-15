const STORAGE_KEY = "evidence-desk:known-job-ids";
const MAX_JOB_IDS = 50;

export function readKnownJobIds(): string[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string").slice(0, MAX_JOB_IDS);
  } catch {
    return [];
  }
}

export function rememberJobId(jobId: string): string[] {
  const next = [jobId, ...readKnownJobIds().filter((item) => item !== jobId)].slice(0, MAX_JOB_IDS);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Job history is optional and remains session-only.
  }
  return next;
}

export function forgetJobId(jobId: string): string[] {
  const next = readKnownJobIds().filter((item) => item !== jobId);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore unavailable session storage
  }
  return next;
}
