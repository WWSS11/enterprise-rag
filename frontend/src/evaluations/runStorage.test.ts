import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetRunId,
  listRunIds,
  rememberRunId,
  type RunStorageScope,
} from "./runStorage";

const tenantA = "tenant/a";
const tenantB = "tenant/b";
const userA = "user:a";
const userB = "user:b";
const datasetA = "11111111-1111-4111-8111-111111111111";
const datasetB = "22222222-2222-4222-8222-222222222222";
const runA = "33333333-3333-4333-8333-333333333333";
const runB = "44444444-4444-4444-8444-444444444444";

const scope = (
  tenant_id = tenantA,
  user_id = userA,
  dataset_id = datasetA,
): RunStorageScope => ({ tenant_id, user_id, dataset_id });
const storageKey = ({ tenant_id, user_id, dataset_id }: RunStorageScope) =>
  [
    "evidence-desk:evaluation-run-ids:v2",
    encodeURIComponent(tenant_id),
    encodeURIComponent(user_id),
    encodeURIComponent(dataset_id),
  ].join(":");

const scopeA = scope();

describe("evaluation run storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("scopes remembered run UUIDs by tenant, user, and dataset", () => {
    const otherDataset = scope(tenantA, userA, datasetB);
    const otherUser = scope(tenantA, userB, datasetA);
    const otherTenant = scope(tenantB, userA, datasetA);

    expect(rememberRunId(scopeA, runA)).toEqual([runA]);
    expect(rememberRunId(scopeA, runB)).toEqual([runB, runA]);
    expect(rememberRunId(scopeA, runA)).toEqual([runA, runB]);
    expect(rememberRunId(otherDataset, runB)).toEqual([runB]);
    expect(rememberRunId(otherUser, runB)).toEqual([runB]);
    expect(rememberRunId(otherTenant, runB)).toEqual([runB]);

    expect(listRunIds(scopeA)).toEqual([runA, runB]);
    expect(listRunIds(otherDataset)).toEqual([runB]);
    expect(listRunIds(otherUser)).toEqual([runB]);
    expect(listRunIds(otherTenant)).toEqual([runB]);
    expect(forgetRunId(scopeA, runA)).toEqual([runB]);
    expect(listRunIds(scopeA)).toEqual([runB]);
    expect(listRunIds(otherDataset)).toEqual([runB]);
  });

  it("caps each scoped history at the 50 newest unique run UUIDs", () => {
    const runIds = Array.from(
      { length: 55 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    for (const runId of runIds) rememberRunId(scopeA, runId);

    const stored = listRunIds(scopeA);
    expect(stored).toHaveLength(50);
    expect(stored[0]).toBe(runIds[54]);
    expect(stored[49]).toBe(runIds[5]);
    expect(stored).not.toContain(runIds[4]);
  });

  it("tolerates malformed scoped storage and filters invalid or duplicate values", () => {
    window.sessionStorage.setItem(storageKey(scopeA), "not-json");
    expect(listRunIds(scopeA)).toEqual([]);

    window.sessionStorage.setItem(storageKey(scopeA), JSON.stringify({ run_id: runA }));
    expect(listRunIds(scopeA)).toEqual([]);

    window.sessionStorage.setItem(
      storageKey(scopeA),
      JSON.stringify([runA, 12, "not-a-uuid", runA, runB, null]),
    );
    expect(listRunIds(scopeA)).toEqual([runA, runB]);
    expect(rememberRunId(scopeA, "still-not-a-uuid")).toEqual([runA, runB]);
  });

  it("ignores legacy unscoped entries and never reads or writes localStorage", () => {
    const legacyKey = `evidence-desk:evaluation-run-ids:${datasetA}`;
    window.sessionStorage.setItem(legacyKey, JSON.stringify([runA]));
    window.localStorage.setItem(storageKey(scopeA), JSON.stringify([runB]));
    window.localStorage.setItem("sentinel", "keep");

    expect(listRunIds(scopeA)).toEqual([]);
    rememberRunId(scopeA, runA);
    forgetRunId(scopeA, runA);

    expect(window.sessionStorage.getItem(legacyKey)).toBe(JSON.stringify([runA]));
    expect(window.sessionStorage.getItem(storageKey(scopeA))).toBe("[]");
    expect(window.localStorage.getItem(storageKey(scopeA))).toBe(JSON.stringify([runB]));
    expect(window.localStorage.getItem("sentinel")).toBe("keep");
  });
});
