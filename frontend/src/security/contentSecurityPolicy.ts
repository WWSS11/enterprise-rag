import type { AppConfig } from "@/config/env";

function sourceOrigin(value: string): string {
  return new URL(value).origin;
}

function websocketOrigin(value: string): string {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

export function contentSecurityPolicy(config: AppConfig): string {
  const apiOrigin = sourceOrigin(config.apiBaseUrl);
  const oidcOrigin = sourceOrigin(config.oidc.authority);
  const appWebsocketOrigin = websocketOrigin(config.appOrigin);
  const connectSources = [...new Set(["'self'", apiOrigin, oidcOrigin, appWebsocketOrigin])];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src 'self' ${oidcOrigin}`,
    `form-action 'self' ${oidcOrigin}`,
    "worker-src 'self' blob:",
  ].join("; ");
}

export function installContentSecurityPolicy(config: AppConfig): void {
  const existing = document.head.querySelector<HTMLMetaElement>(
    'meta[http-equiv="Content-Security-Policy"]',
  );
  const element = existing ?? document.createElement("meta");
  element.httpEquiv = "Content-Security-Policy";
  element.content = contentSecurityPolicy(config);
  if (!existing) document.head.prepend(element);
}
