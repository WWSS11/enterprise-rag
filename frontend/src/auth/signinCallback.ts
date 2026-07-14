import type { User } from "oidc-client-ts";
import { getUserManager } from "./userManager";

/**
 * React StrictMode runs effects twice in development. Authorization codes are
 * single-use, so signinRedirectCallback must run at most once per redirect.
 */
let redirectCallbackInflight: Promise<User> | null = null;
let redirectCallbackResult: User | null = null;

export function signinRedirectCallbackOnce(): Promise<User> {
  if (redirectCallbackResult) {
    return Promise.resolve(redirectCallbackResult);
  }
  if (!redirectCallbackInflight) {
    redirectCallbackInflight = getUserManager()
      .signinRedirectCallback()
      .then((user) => {
        redirectCallbackResult = user;
        return user;
      })
      .catch((error: unknown) => {
        // Allow a manual retry only after failure (e.g. user restarts login).
        redirectCallbackInflight = null;
        throw error;
      });
  }
  return redirectCallbackInflight;
}

/** Call when starting a fresh interactive login. */
export function clearSigninRedirectCallbackCache(): void {
  redirectCallbackInflight = null;
  redirectCallbackResult = null;
}

export function __resetRedirectCallbackForTests(): void {
  clearSigninRedirectCallbackCache();
}
