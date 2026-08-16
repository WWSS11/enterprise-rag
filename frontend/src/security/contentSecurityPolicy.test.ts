import { afterEach, describe, expect, it } from "vitest";
import { buildConfig } from "@/config/env";
import {
  contentSecurityPolicy,
  installContentSecurityPolicy,
} from "./contentSecurityPolicy";

afterEach(() => {
  document.head
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.remove();
});

describe("runtime Content Security Policy", () => {
  it("allows only the configured API and OIDC origins required by login", () => {
    const config = buildConfig({
      appOrigin: window.location.origin,
      apiBaseUrl: "https://api.example.com/v1",
      oidcAuthority: "https://id.example.com/realms/rag",
      oidcClientId: "rag-web",
      oidcScope: "openid profile email",
    });

    const policy = contentSecurityPolicy(config);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self' https://api.example.com https://id.example.com");
    expect(policy).toContain("frame-src 'self' https://id.example.com");
    expect(policy).toContain("form-action 'self' https://id.example.com");
    expect(policy).not.toContain("https://attacker.example");
  });

  it("installs one policy element before the application is imported", () => {
    const config = buildConfig({ appOrigin: window.location.origin });
    installContentSecurityPolicy(config);
    installContentSecurityPolicy(config);

    const elements = document.head.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    expect(elements).toHaveLength(1);
    expect(elements[0]?.getAttribute("content")).toContain("script-src 'self'");
  });
});
