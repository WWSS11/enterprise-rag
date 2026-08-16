import { expect, test, type Page } from "@playwright/test";
import {
  accessTokenFromSessionStorage,
  apiBaseUrl,
  clearBrowserAuth,
  loginThroughKeycloak,
} from "./helpers";

type KnowledgeBase = { id: string; slug: string };
type Job = { id: string; status: string };
type JobPage = { items: Job[] };
type Sample = { status: number; latencyMs: number };
type StreamSample = Sample & {
  firstTokenMs: number | null;
  conversationId: string | null;
  completed: boolean;
};

function percentile(values: number[], quantile: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)] ?? 0;
}

async function authenticate(page: Page): Promise<string> {
  await clearBrowserAuth(page);
  const identity = await loginThroughKeycloak(page, "/app/system");
  expect(identity.isAdmin).toBe(true);
  const token = await accessTokenFromSessionStorage(page);
  expect(token).not.toBeNull();
  return token!;
}

async function readLoad(page: Page, token: string, path: string): Promise<Sample> {
  const started = performance.now();
  const response = await page.request.get(`${apiBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await response.body();
  return { status: response.status(), latencyMs: performance.now() - started };
}

async function waitForJob(page: Page, token: string, jobId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${apiBaseUrl()}/api/v1/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status()).toBe(200);
        return ((await response.json()) as Job).status;
      },
      { timeout: 180_000, intervals: [500, 1_000, 2_500] },
    )
    .toBe("succeeded");
}

test("runs bounded concurrent ingestion, reindex, and deletion work", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const token = await authenticate(page);
  const stamp = Date.now();
  const created = await page.request.post(`${apiBaseUrl()}/api/v1/knowledge-bases`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      slug: `e2e-t15-batch-${stamp}`,
      name: `T15 batch ${stamp}`,
      description: "Temporary bounded T15 batch fixture",
      access_mode: "restricted",
    },
  });
  expect(created.status()).toBe(201);
  const knowledgeBase = (await created.json()) as KnowledgeBase;
  const documentIds: string[] = [];
  let maxActiveJobs = 0;

  async function activeJobs(): Promise<number> {
    const response = await page.request.get(
      `${apiBaseUrl()}/api/v1/jobs?knowledge_base_id=${knowledgeBase.id}&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status()).toBe(200);
    const jobs = (await response.json()) as JobPage;
    const active = jobs.items.filter((job) => ["queued", "running"].includes(job.status)).length;
    maxActiveJobs = Math.max(maxActiveJobs, active);
    return active;
  }

  const timings: Record<string, number> = {};
  try {
    const uploadStarted = performance.now();
    const uploads = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        page.request.post(`${apiBaseUrl()}/api/v1/documents`, {
          headers: { Authorization: `Bearer ${token}` },
          multipart: {
            knowledge_base_id: knowledgeBase.id,
            file: {
              name: `t15-batch-${index + 1}.md`,
              mimeType: "text/markdown",
              buffer: Buffer.from(
                `# T15 batch ${index + 1}\n\nApproved synthetic fact ${stamp}-${index + 1}.`,
              ),
            },
          },
        }),
      ),
    );
    expect(uploads.every((response) => response.status() === 202)).toBe(true);
    const uploadPayloads = await Promise.all(
      uploads.map(
        async (response) =>
          (await response.json()) as { document: { id: string }; job_id: string },
      ),
    );
    documentIds.push(...uploadPayloads.map((payload) => payload.document.id));
    await activeJobs();
    await Promise.all(uploadPayloads.map((payload) => waitForJob(page, token, payload.job_id)));
    timings.ingestion_ms = Number((performance.now() - uploadStarted).toFixed(3));

    const reindexStarted = performance.now();
    const reindexes = await Promise.all(
      documentIds.map((documentId) =>
        page.request.post(`${apiBaseUrl()}/api/v1/documents/${documentId}/reindex`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
    );
    expect(reindexes.every((response) => response.status() === 202)).toBe(true);
    const reindexJobs = await Promise.all(
      reindexes.map(async (response) => (await response.json()) as Job),
    );
    await activeJobs();
    await Promise.all(reindexJobs.map((job) => waitForJob(page, token, job.id)));
    timings.reindex_ms = Number((performance.now() - reindexStarted).toFixed(3));

    const deletionStarted = performance.now();
    const deletions = await Promise.all(
      documentIds.map((documentId) =>
        page.request.delete(`${apiBaseUrl()}/api/v1/documents/${documentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
    );
    expect(deletions.every((response) => response.status() === 202)).toBe(true);
    const deletionJobs = await Promise.all(
      deletions.map(async (response) => (await response.json()) as Job),
    );
    await activeJobs();
    await Promise.all(deletionJobs.map((job) => waitForJob(page, token, job.id)));
    timings.deletion_ms = Number((performance.now() - deletionStarted).toFixed(3));
    documentIds.length = 0;
  } finally {
    for (const documentId of documentIds) {
      const deletion = await page.request.delete(
        `${apiBaseUrl()}/api/v1/documents/${documentId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (deletion.status() === 202) {
        await waitForJob(page, token, ((await deletion.json()) as Job).id).catch(
          () => undefined,
        );
      }
    }
    const archived = await page.request.post(
      `${apiBaseUrl()}/api/v1/knowledge-bases/${knowledgeBase.id}/archive`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(archived.status()).toBe(200);
  }

  const report = { documents: 6, worker_concurrency: 2, max_active_jobs: maxActiveJobs, ...timings };
  console.log(`T15_BATCH_RESULT ${JSON.stringify(report)}`);
  await testInfo.attach("t15-batch-result.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});

test("measures bounded control-plane reads and concurrent real chat streams", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  let token = await authenticate(page);
  const paths = [
    "/api/v1/auth/me",
    "/api/v1/knowledge-bases?include_archived=false",
    "/api/v1/jobs?limit=50&offset=0",
    "/api/v1/evaluations/datasets",
    "/api/v1/conversations?limit=50&offset=0",
    "/api/v1/audit-logs?limit=50&offset=0",
  ];
  const readReport: Record<string, object> = {};
  for (const path of paths) {
    const samples: Sample[] = [];
    for (let batch = 0; batch < 5; batch += 1) {
      samples.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, () => readLoad(page, token, path)),
        )),
      );
    }
    expect(samples.every((sample) => sample.status === 200)).toBe(true);
    const latencies = samples.map((sample) => sample.latencyMs);
    const p95 = percentile(latencies, 0.95);
    expect(p95).toBeLessThan(1_000);
    readReport[path] = {
      requests: samples.length,
      concurrency: 10,
      errors: samples.filter((sample) => sample.status !== 200).length,
      p50_ms: Number(percentile(latencies, 0.5).toFixed(3)),
      p95_ms: Number(p95.toFixed(3)),
      p99_ms: Number(percentile(latencies, 0.99).toFixed(3)),
      max_ms: Number(Math.max(...latencies).toFixed(3)),
    };
  }

  const basesResponse = await page.request.get(`${apiBaseUrl()}/api/v1/knowledge-bases`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(basesResponse.status()).toBe(200);
  const bases = (await basesResponse.json()) as KnowledgeBase[];
  const publicBaseline = bases.find((item) => item.slug === "public-compliance-baseline-v2");
  expect(publicBaseline).toBeDefined();

  token = await authenticate(page);
  const streamSamples = await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      page.evaluate(
        async ({ apiUrl, accessToken, knowledgeBaseId, questionIndex }) => {
          const started = performance.now();
          const response = await fetch(`${apiUrl}/api/v1/chat/stream`, {
            method: "POST",
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              question: `劳动合同试用期规则是什么？并发样本 ${questionIndex + 1}`,
              knowledge_base_id: knowledgeBaseId,
            }),
          });
          let firstTokenMs: number | null = null;
          let text = "";
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              text += decoder.decode(value, { stream: true });
              if (firstTokenMs === null && text.includes("event: token")) {
                firstTokenMs = performance.now() - started;
              }
            }
            text += decoder.decode();
          }
          const conversationId =
            /"conversation_id"\s*:\s*"([0-9a-f-]{36})"/i.exec(text)?.[1] ?? null;
          return {
            status: response.status,
            latencyMs: performance.now() - started,
            firstTokenMs,
            conversationId,
            completed: text.includes('event: done\ndata: {"status":"completed"}'),
          } satisfies StreamSample;
        },
        {
          apiUrl: apiBaseUrl(),
          accessToken: token,
          knowledgeBaseId: publicBaseline!.id,
          questionIndex: index,
        },
      ),
    ),
  );
  expect(streamSamples.every((sample) => sample.status === 200 && sample.completed)).toBe(true);
  expect(streamSamples.every((sample) => sample.firstTokenMs !== null)).toBe(true);
  const firstTokens = streamSamples.map((sample) => sample.firstTokenMs ?? 600_000);
  const totals = streamSamples.map((sample) => sample.latencyMs);
  expect(percentile(firstTokens, 0.95)).toBeLessThan(30_000);
  expect(percentile(totals, 0.95)).toBeLessThan(60_000);

  for (const conversationId of streamSamples
    .map((sample) => sample.conversationId)
    .filter((value): value is string => Boolean(value))) {
    const archived = await page.request.post(
      `${apiBaseUrl()}/api/v1/conversations/${conversationId}/archive`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(archived.status()).toBe(200);
  }

  const report = {
    reads: readReport,
    streams: {
      requests: streamSamples.length,
      concurrency: streamSamples.length,
      errors: streamSamples.filter((sample) => !sample.completed).length,
      first_token_p50_ms: Number(percentile(firstTokens, 0.5).toFixed(3)),
      first_token_p95_ms: Number(percentile(firstTokens, 0.95).toFixed(3)),
      total_p50_ms: Number(percentile(totals, 0.5).toFixed(3)),
      total_p95_ms: Number(percentile(totals, 0.95).toFixed(3)),
    },
  };
  console.log(`T15_LOAD_RESULT ${JSON.stringify(report)}`);
  await testInfo.attach("t15-load-result.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});
