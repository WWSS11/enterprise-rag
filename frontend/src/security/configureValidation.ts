import { z } from "zod";

/**
 * Keep schema validation compatible with the application's strict CSP.
 * This must run before the first schema parse so Zod never probes or uses
 * dynamic function compilation.
 */
export function configureValidation(): void {
  z.config({ jitless: true });
}
