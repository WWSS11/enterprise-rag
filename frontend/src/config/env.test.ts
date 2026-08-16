import { describe, expect, it, vi } from "vitest";
import { config, loadRuntimeConfig } from "./env";

function runtimeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runtime config", () => {
  it("loads public deployment values before the application starts", async () => {
    const fetchConfig = vi.fn(async () =>
      runtimeResponse({
        appOrigin: window.location.origin,
        apiBaseUrl: "https://api.example.com",
        oidcAuthority: "https://id.example.com/realms/rag",
        oidcClientId: "rag-web",
        oidcScope: "openid profile email",
      }),
    );

    await loadRuntimeConfig(fetchConfig);

    expect(fetchConfig).toHaveBeenCalledWith("/config.json", { cache: "no-store" });
    expect(config.apiBaseUrl).toBe("https://api.example.com");
    expect(config.oidc.authority).toBe("https://id.example.com/realms/rag");
    expect(config.oidc.redirectUri).toBe(`${window.location.origin}/auth/callback`);
  });

  it("rejects unknown keys instead of silently ignoring deployment typos", async () => {
    const fetchConfig = vi.fn(async () => runtimeResponse({ apiBaseURL: "https://typo" }));

    await expect(loadRuntimeConfig(fetchConfig)).rejects.toThrow(
      "Unknown runtime config key: apiBaseURL",
    );
  });

  it("rejects open redirects, insecure remote endpoints, and non-OIDC scopes", async () => {
    await expect(
      loadRuntimeConfig(
        vi.fn(async () =>
          runtimeResponse({
            appOrigin: "https://attacker.example",
            apiBaseUrl: "https://api.example.com",
            oidcAuthority: "https://id.example.com/realm",
          }),
        ),
      ),
    ).rejects.toThrow("appOrigin must exactly match");

    await expect(
      loadRuntimeConfig(
        vi.fn(async () =>
          runtimeResponse({
            appOrigin: window.location.origin,
            apiBaseUrl: "http://api.example.com",
            oidcAuthority: "https://id.example.com/realm",
          }),
        ),
      ),
    ).rejects.toThrow("apiBaseUrl must use HTTPS");

    await expect(
      loadRuntimeConfig(
        vi.fn(async () =>
          runtimeResponse({
            appOrigin: window.location.origin,
            apiBaseUrl: "https://api.example.com",
            oidcAuthority: "https://id.example.com/realm",
            oidcScope: "profile email",
          }),
        ),
      ),
    ).rejects.toThrow("oidcScope must include openid");
  });
});
