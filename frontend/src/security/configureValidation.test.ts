import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { configureValidation } from "./configureValidation";

afterEach(() => {
  z.config({ jitless: undefined });
});

describe("validation runtime configuration", () => {
  it("disables dynamic schema compilation for strict CSP environments", () => {
    configureValidation();

    expect(z.config().jitless).toBe(true);
  });
});
