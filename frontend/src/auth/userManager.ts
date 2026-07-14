import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from "oidc-client-ts";
import { config } from "@/config/env";

/**
 * OIDC UserManager — Authorization Code + PKCE only.
 * State/user store: sessionStorage. Never localStorage for tokens.
 * Never log tokens.
 */
function createSettings(): UserManagerSettings {
  return {
    authority: config.oidc.authority,
    client_id: config.oidc.clientId,
    redirect_uri: config.oidc.redirectUri,
    silent_redirect_uri: config.oidc.silentRedirectUri,
    post_logout_redirect_uri: config.oidc.postLogoutRedirectUri,
    response_type: "code",
    scope: config.oidc.scope,
    automaticSilentRenew: true,
    monitorSession: false,
    loadUserInfo: false,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  };
}

let manager: UserManager | null = null;

export function getUserManager(): UserManager {
  if (!manager) {
    manager = new UserManager(createSettings());
  }
  return manager;
}

/** Test-only reset */
export function __resetUserManagerForTests(): void {
  manager = null;
}

export type { User };
