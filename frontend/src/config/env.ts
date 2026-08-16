type RuntimeConfigFile = {
  hostIp?: string;
  appOrigin?: string;
  apiBaseUrl?: string;
  oidcAuthority?: string;
  oidcClientId?: string;
  oidcScope?: string;
};

const runtimeConfigKeys = new Set<keyof RuntimeConfigFile>([
  "hostIp",
  "appOrigin",
  "apiBaseUrl",
  "oidcAuthority",
  "oidcClientId",
  "oidcScope",
]);

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function httpUrl(name: string, value: string, originOnly = false): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${name} must not contain user information or a fragment`);
  }
  if (parsed.protocol !== "https:" && !isLoopback(parsed.hostname)) {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  if (originOnly && (parsed.pathname !== "/" || parsed.search)) {
    throw new Error(`${name} must contain an origin without a path or query`);
  }
  return originOnly ? parsed.origin : value.replace(/\/$/, "");
}

function runtimeString(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Runtime config ${name} must be a string`);
  }
  return optional(value);
}

function parseRuntimeConfig(value: unknown): RuntimeConfigFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime config must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!runtimeConfigKeys.has(key as keyof RuntimeConfigFile)) {
      throw new Error(`Unknown runtime config key: ${key}`);
    }
  }

  return {
    hostIp: runtimeString("hostIp", record.hostIp),
    appOrigin: runtimeString("appOrigin", record.appOrigin),
    apiBaseUrl: runtimeString("apiBaseUrl", record.apiBaseUrl),
    oidcAuthority: runtimeString("oidcAuthority", record.oidcAuthority),
    oidcClientId: runtimeString("oidcClientId", record.oidcClientId),
    oidcScope: runtimeString("oidcScope", record.oidcScope),
  };
}

export function buildConfig(runtime: RuntimeConfigFile) {
  const hostIp = runtime.hostIp ?? optional(import.meta.env.VITE_HOST_IP) ?? "127.0.0.1";
  const appOrigin = httpUrl(
    "appOrigin",
    runtime.appOrigin ??
      optional(import.meta.env.VITE_APP_ORIGIN) ??
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"),
    true,
  );
  if (typeof window !== "undefined" && appOrigin !== window.location.origin) {
    throw new Error("appOrigin must exactly match the browser origin");
  }

  const apiBaseUrl = httpUrl(
    "apiBaseUrl",
    runtime.apiBaseUrl ??
      optional(import.meta.env.VITE_API_BASE_URL) ??
      `http://${hostIp}:8000`,
  );
  const oidcAuthority = httpUrl(
    "oidcAuthority",
    runtime.oidcAuthority ??
      optional(import.meta.env.VITE_OIDC_AUTHORITY) ??
      `http://${hostIp}:18080/realms/enterprise-rag`,
  );
  if (
    new URL(appOrigin).protocol === "https:" &&
    (new URL(apiBaseUrl).protocol !== "https:" ||
      new URL(oidcAuthority).protocol !== "https:")
  ) {
    throw new Error("HTTPS applications require HTTPS API and OIDC endpoints");
  }

  const oidcClientId =
    runtime.oidcClientId ??
    optional(import.meta.env.VITE_OIDC_CLIENT_ID) ??
    "enterprise-rag-web";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(oidcClientId)) {
    throw new Error("oidcClientId is invalid");
  }
  const oidcScope =
    runtime.oidcScope ??
    optional(import.meta.env.VITE_OIDC_SCOPE) ??
    "openid profile email";
  if (!oidcScope.split(/\s+/).includes("openid")) {
    throw new Error("oidcScope must include openid");
  }

  return {
    hostIp,
    appOrigin,
    apiBaseUrl,
    oidc: {
      authority: oidcAuthority,
      clientId: oidcClientId,
      scope: oidcScope,
      redirectUri: `${appOrigin}/auth/callback`,
      silentRedirectUri: `${appOrigin}/auth/silent-callback`,
      postLogoutRedirectUri: `${appOrigin}/login`,
    },
  } as const;
}

export type AppConfig = ReturnType<typeof buildConfig>;

export let config: AppConfig = buildConfig({});

export async function loadRuntimeConfig(
  fetchConfig: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<void> {
  const response = await fetchConfig("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load runtime config: HTTP ${response.status}`);
  }
  config = buildConfig(parseRuntimeConfig(await response.json()));
}
