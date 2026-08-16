import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(frontendRoot, "..");
const exceptionFile = join(repositoryRoot, ".github", "audit-exceptions.json");
const exceptions = JSON.parse(readFileSync(exceptionFile, "utf8")).npm ?? [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const audit = spawnSync(
  npmCommand,
  ["audit", "--json", "--registry=https://registry.npmjs.org"],
  {
    cwd: frontendRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (audit.error) {
  console.error(`Unable to run npm audit: ${audit.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("npm audit did not return valid JSON.");
  process.exit(1);
}

if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? report.error.code ?? "unknown error"}`);
  process.exit(1);
}

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const vulnerabilities = report.vulnerabilities ?? {};
const advisories = new Map();

function collect(packageName, visited = new Set()) {
  if (visited.has(packageName)) return;
  visited.add(packageName);
  const vulnerability = vulnerabilities[packageName];
  if (!vulnerability) return;

  for (const cause of vulnerability.via ?? []) {
    if (typeof cause === "string") {
      collect(cause, visited);
      continue;
    }
    const id = cause.url?.split("/").filter(Boolean).at(-1) ?? String(cause.source);
    advisories.set(id, {
      id,
      severity: cause.severity ?? vulnerability.severity ?? "unknown",
      packageName,
      title: cause.title ?? "Untitled advisory",
      url: cause.url ?? "",
    });
  }
}

for (const packageName of Object.keys(vulnerabilities)) collect(packageName);

const today = new Date().toISOString().slice(0, 10);
const exceptionById = new Map(exceptions.map((item) => [item.id, item]));
const blocking = [];
const accepted = [];

for (const advisory of advisories.values()) {
  if ((severityRank[advisory.severity] ?? 99) < severityRank.high) continue;
  const exception = exceptionById.get(advisory.id);
  if (exception && exception.expires >= today) {
    accepted.push({ advisory, exception });
  } else {
    blocking.push(advisory);
  }
}

for (const { advisory, exception } of accepted) {
  console.warn(
    `Accepted ${advisory.severity} advisory ${advisory.id} until ${exception.expires}: ${exception.reason}`,
  );
}

if (blocking.length > 0) {
  for (const advisory of blocking) {
    console.error(
      `Blocking ${advisory.severity} advisory ${advisory.id} in ${advisory.packageName}: ${advisory.title}`,
    );
  }
  process.exit(1);
}

console.log(`npm audit passed (${accepted.length} active exception${accepted.length === 1 ? "" : "s"}).`);
