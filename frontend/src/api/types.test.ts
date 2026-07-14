import { describe, expect, it } from "vitest";
import { problemDetailsSchema, currentIdentitySchema } from "./types";

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
});
