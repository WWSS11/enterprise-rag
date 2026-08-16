import { describe, expect, it } from "vitest";
import {
  currentIdentitySchema,
  directoryPrincipalSchema,
  feishuConnectorStatusSchema,
  problemDetailsSchema,
} from "./types";

describe("schemas", () => {
  it("accepts CurrentIdentityRead shape from API", () => {
    const parsed = currentIdentitySchema.parse({
      user_id: "rag-admin",
      tenant_id: "default",
      roles: ["rag-admin"],
      groups: ["engineering"],
      auth_method: "oidc",
      is_admin: true,
    });
    expect(parsed.is_admin).toBe(true);
  });

  it("accepts problem details payload", () => {
    const parsed = problemDetailsSchema.parse({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "missing token",
      request_id: "r1",
    });
    expect(parsed.request_id).toBe("r1");
  });

  it("accepts an enterprise directory principal", () => {
    const parsed = directoryPrincipalSchema.parse({
      principal_type: "group",
      principal_id: "/engineering/platform",
      display_name: "Platform",
      secondary_text: "/engineering/platform",
    });
    expect(parsed.principal_id).toBe("/engineering/platform");
  });

  it("accepts the safe Feishu connector status without credential values", () => {
    const parsed = feishuConnectorStatusSchema.parse({
      provider: "feishu",
      enabled: true,
      ready: false,
      tenant_id: "default",
      space_id: "space-1",
      run_as_user: "connector-bot",
      app_id_configured: true,
      app_secret_configured: true,
      knowledge_base_id: null,
      knowledge_base_name: null,
      checks: [{
        key: "knowledge_base",
        status: "failed",
        message: "not writable",
        error_code: null,
        log_id: null,
        details: {},
      }],
      active_job: null,
      latest_job: null,
    });
    expect(parsed.app_secret_configured).toBe(true);
    expect(parsed).not.toHaveProperty("app_secret");
    expect(parsed).not.toHaveProperty("app_id");
  });
});
