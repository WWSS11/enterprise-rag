import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import {
  accessTokenFromSessionStorage,
  apiBaseUrl,
  clearBrowserAuth,
  loginThroughKeycloak,
} from "./helpers";

const execFileAsync = promisify(execFile);
const packageVersion = process.env.E2E_T13_PACKAGE_VERSION?.trim() || "v1";
if (!/^v[12]$/.test(packageVersion)) {
  throw new Error("E2E_T13_PACKAGE_VERSION must be v1 or v2");
}
const packageSlug = `public-compliance-baseline-${packageVersion}`;
const packageManifest = `docs/evaluation-datasets/public-compliance-${packageVersion}.json`;
const requirePassingGate = packageVersion === "v2";
const runIndexRebuild = packageVersion === "v1" || process.env.E2E_T13_REBUILD === "1";

type Job = { id: string; status: string; progress?: number };
type KnowledgeBase = { id: string; slug: string; status: string };
type DocumentRecord = { id: string };
type EvaluationDataset = { id: string; knowledge_base_id: string };
type EvaluationRun = {
  id: string;
  status: string;
  summary: Record<string, unknown>;
  failed_cases: number;
  created_at: string;
};
type EvaluationRunPage = { items: EvaluationRun[] };
type JobPage = { items: Job[] };

async function apiJson<T>(
  page: Page,
  token: string,
  method: "GET" | "POST" | "DELETE",
  pathName: string,
  data?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await page.request.fetch(`${apiBaseUrl()}${pathName}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  const body = (await response.json().catch(() => ({}))) as T;
  return { status: response.status(), body };
}

async function waitForJob(page: Page, token: string, jobId: string): Promise<Job> {
  let job: Job = { id: jobId, status: "unknown" };
  await expect
    .poll(
      async () => {
        const result = await apiJson<Job>(page, token, "GET", `/api/v1/jobs/${jobId}`);
        expect(result.status).toBe(200);
        job = result.body;
        return job.status;
      },
      { timeout: 900_000, intervals: [1_000, 2_500, 5_000] },
    )
    .toMatch(/^(succeeded|failed)$/);
  expect(job.status).toBe("succeeded");
  return job;
}

async function waitForRun(page: Page, token: string, runId: string): Promise<EvaluationRun> {
  let run: EvaluationRun = {
    id: runId,
    status: "unknown",
    summary: {},
    failed_cases: 0,
    created_at: "",
  };
  await expect
    .poll(
      async () => {
        const result = await apiJson<EvaluationRun>(
          page,
          token,
          "GET",
          `/api/v1/evaluations/runs/${runId}`,
        );
        expect(result.status).toBe(200);
        run = result.body;
        return run.status;
      },
      { timeout: 1_800_000, intervals: [2_500, 5_000, 10_000] },
    )
    .toMatch(/^(succeeded|failed)$/);
  expect(run.status).toBe("succeeded");
  return run;
}

async function authenticateAdmin(page: Page): Promise<string> {
  await clearBrowserAuth(page);
  const identity = await loginThroughKeycloak(page, "/app/system");
  expect(identity.isAdmin).toBe(true);
  const token = await accessTokenFromSessionStorage(page);
  expect(token).not.toBeNull();
  return token!;
}

async function latestSucceededRebuild(page: Page, token: string): Promise<Job> {
  const rebuildJobs = await apiJson<JobPage>(
    page,
    token,
    "GET",
    "/api/v1/jobs?job_type=vector_index_rebuild&limit=10",
  );
  expect(rebuildJobs.status).toBe(200);
  const rebuild = rebuildJobs.body.items.find((job) => job.status === "succeeded");
  expect(rebuild).toBeDefined();
  return rebuild!;
}

test("runs the requested T13 package and gates a candidate", async ({
  page,
}, testInfo) => {
  test.setTimeout(3_600_000);
  let token = await authenticateAdmin(page);

  const knowledgeBases = await apiJson<KnowledgeBase[]>(
    page,
    token,
    "GET",
    "/api/v1/knowledge-bases?include_archived=false",
  );
  expect(knowledgeBases.status).toBe(200);
  const stale = knowledgeBases.body.filter((item) => item.slug.startsWith("e2e-live-"));

  for (const knowledgeBase of stale) {
    const documents = await apiJson<DocumentRecord[]>(
      page,
      token,
      "GET",
      `/api/v1/documents?knowledge_base_id=${knowledgeBase.id}`,
    );
    expect(documents.status).toBe(200);
    for (const document of documents.body) {
      const deleted = await apiJson<Job>(
        page,
        token,
        "DELETE",
        `/api/v1/documents/${document.id}`,
      );
      expect(deleted.status).toBe(202);
      await waitForJob(page, token, deleted.body.id);
    }
    const archived = await apiJson<KnowledgeBase>(
      page,
      token,
      "POST",
      `/api/v1/knowledge-bases/${knowledgeBase.id}/archive`,
    );
    expect(archived.status).toBe(200);
  }

  let importResult: {
    baseline_run_id: string;
    dataset_id: string;
    knowledge_base_id: string;
    baseline_summary: Record<string, unknown>;
  };
  let rebuildJob: Job;
  let candidate: EvaluationRun;
  const existingKnowledgeBase = knowledgeBases.body.find(
    (item) => item.slug === packageSlug,
  );

  if (!existingKnowledgeBase) {
    const repositoryRoot = path.resolve(process.cwd(), "..");
    const imported = await execFileAsync(
      path.join(repositoryRoot, ".venv/bin/python"),
      [
        "scripts/import_evaluation_package.py",
        packageManifest,
        "--repository-root",
        ".",
        "--apply",
        "--start-run",
        "--poll-timeout",
        "1800",
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, T13_ACCESS_TOKEN: token },
        timeout: 2_100_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    importResult = JSON.parse(imported.stdout.trim()) as typeof importResult;
    token = await authenticateAdmin(page);
    if (runIndexRebuild) {
      const rebuild = await apiJson<Job>(page, token, "POST", "/api/v1/jobs/rebuild-index");
      expect(rebuild.status).toBe(202);
      rebuildJob = await waitForJob(page, token, rebuild.body.id);
    } else {
      rebuildJob = await latestSucceededRebuild(page, token);
    }
    const candidateCreated = await apiJson<EvaluationRun>(
      page,
      token,
      "POST",
      "/api/v1/evaluations/runs",
      { dataset_id: importResult.dataset_id },
    );
    expect(candidateCreated.status).toBe(202);
    candidate = await waitForRun(page, token, candidateCreated.body.id);
  } else {
    const datasets = await apiJson<EvaluationDataset[]>(
      page,
      token,
      "GET",
      "/api/v1/evaluations/datasets",
    );
    expect(datasets.status).toBe(200);
    const dataset = datasets.body.find(
      (item) => item.knowledge_base_id === existingKnowledgeBase.id,
    );
    expect(dataset).toBeDefined();
    const runs = await apiJson<EvaluationRunPage>(
      page,
      token,
      "GET",
      `/api/v1/evaluations/runs?dataset_id=${dataset!.id}&limit=100`,
    );
    expect(runs.status).toBe(200);
    expect(runs.body.items.length).toBeGreaterThanOrEqual(2);
    const orderedRuns = [...runs.body.items].sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
    const baseline = orderedRuns[0];
    candidate = orderedRuns.at(-1)!;
    importResult = {
      baseline_run_id: baseline.id,
      dataset_id: dataset!.id,
      knowledge_base_id: existingKnowledgeBase.id,
      baseline_summary: baseline.summary,
    };
    rebuildJob = await latestSucceededRebuild(page, token);
    if (candidate.status !== "succeeded") {
      candidate = await waitForRun(page, token, candidate.id);
    }
  }

  token = await authenticateAdmin(page);

  for (const runId of [importResult.baseline_run_id, candidate.id]) {
    const recalculated = await apiJson<EvaluationRun>(
      page,
      token,
      "POST",
      `/api/v1/evaluations/runs/${runId}/recalculate`,
    );
    expect(recalculated.status).toBe(200);
    if (runId === importResult.baseline_run_id) {
      importResult.baseline_summary = recalculated.body.summary;
    } else {
      candidate = recalculated.body;
    }
  }

  const comparison = await apiJson<Record<string, unknown>>(
    page,
    token,
    "POST",
    `/api/v1/evaluations/runs/${candidate.id}/compare`,
    { baseline_run_id: importResult.baseline_run_id },
  );
  expect(comparison.status).toBe(200);
  const gate = await apiJson<Record<string, unknown>>(
    page,
    token,
    "POST",
    `/api/v1/evaluations/runs/${candidate.id}/gate`,
    { baseline_run_id: importResult.baseline_run_id },
  );
  if (requirePassingGate) {
    expect(gate.status).toBe(200);
  } else {
    expect([200, 409]).toContain(gate.status);
  }

  await testInfo.attach("t13-maintenance-result.json", {
    body: JSON.stringify(
      {
        stale_knowledge_bases_archived: stale.map((item) => item.id),
        knowledge_base_id: importResult.knowledge_base_id,
        dataset_id: importResult.dataset_id,
        baseline_run_id: importResult.baseline_run_id,
        candidate_run_id: candidate.id,
        baseline_summary: importResult.baseline_summary,
        candidate_summary: candidate.summary,
        candidate_failed_cases: candidate.failed_cases,
        rebuild_job_id: rebuildJob.id,
        gate_http_status: gate.status,
        package_version: packageVersion,
        gate: gate.body,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
