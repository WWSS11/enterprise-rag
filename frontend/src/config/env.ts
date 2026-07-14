/**
 * Runtime configuration.
 * Prefer VITE_HOST_IP so Keycloak and API share one reachable host.
 * Full URL overrides win when set.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const hostIp = optional(import.meta.env.VITE_HOST_IP) ?? "127.0.0.1";

const appOrigin =
  optional(import.meta.env.VITE_APP_ORIGIN) ??
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export const config = {
  hostIp,
  appOrigin,
  apiBaseUrl: optional(import.meta.env.VITE_API_BASE_URL) ?? `http://${hostIp}:8000`,
  oidc: {
    authority:
      optional(import.meta.env.VITE_OIDC_AUTHORITY) ??
      `http://${hostIp}:18080/realms/enterprise-rag`,
    clientId: required("VITE_OIDC_CLIENT_ID", import.meta.env.VITE_OIDC_CLIENT_ID),
    scope: optional(import.meta.env.VITE_OIDC_SCOPE) ?? "openid profile email",
    redirectUri: `${appOrigin}/auth/callback`,
    silentRedirectUri: `${appOrigin}/auth/silent-callback`,
    postLogoutRedirectUri: `${appOrigin}/login`,
  },
} as const;

export type AppConfig = typeof config;
