import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./sessionPaths";

describe("OIDC return path validation", () => {
  it("preserves bounded application routes", () => {
    expect(safeReturnPath("/app/evaluations?dataset=one#result")).toBe(
      "/app/evaluations?dataset=one#result",
    );
    expect(safeReturnPath("/app")).toBe("/app");
  });

  it.each([
    "https://attacker.example/",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "/%2f%2fattacker.example/path",
    "/login",
    "/auth/callback",
    "/app/chat\u0000",
    "%broken",
  ])("rejects unsafe or non-application return path %s", (path) => {
    expect(safeReturnPath(path)).toBe("/app/chat");
  });
});
