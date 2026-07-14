import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "oidc-client-ts";
import { createApiClient } from "@/api/client";
import { ApiError, isApiError } from "@/api/errors";
import type { CurrentIdentity } from "@/api/types";
import { getUserManager } from "./userManager";
import { setAuthAccessToken, getAuthAccessToken } from "./authSession";
import { RETURN_PATH_KEY, safeReturnPath, markJustLoggedOut } from "./sessionPaths";
import { AuthContext, type AuthContextValue, type AuthStatus } from "./authContext";
import { signinRedirectCallbackOnce, clearSigninRedirectCallbackCache } from "./signinCallback";

export type { AuthContextValue, AuthStatus };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("bootstrapping");
  const [user, setUser] = useState<User | null>(null);
  const [identity, setIdentity] = useState<CurrentIdentity | null>(null);
  const [identityError, setIdentityError] = useState<ApiError | Error | null>(null);

  const writeUser = useCallback((next: User | null) => {
    const token = next && !next.expired ? (next.access_token ?? null) : null;
    setAuthAccessToken(token);
    setUser(next);
  }, []);

  const renewToken = useCallback(async (): Promise<string | null> => {
    try {
      const renewed = await getUserManager().signinSilent();
      if (!renewed || renewed.expired) {
        writeUser(null);
        return null;
      }
      writeUser(renewed);
      return renewed.access_token ?? null;
    } catch {
      writeUser(null);
      return null;
    }
  }, [writeUser]);

  const api = useMemo(
    () =>
      createApiClient({
        getAccessToken: async () => getAuthAccessToken(),
        renewAccessToken: renewToken,
      }),
    [renewToken],
  );

  const refreshIdentity = useCallback(async (): Promise<CurrentIdentity | null> => {
    try {
      const me = await api.getMe();
      setIdentity(me);
      setIdentityError(null);
      setStatus("authenticated");
      return me;
    } catch (error) {
      setIdentity(null);
      setIdentityError(isApiError(error) ? error : error instanceof Error ? error : new Error(String(error)));
      setStatus("identity_error");
      return null;
    }
  }, [api]);

  const applyUser = useCallback(
    async (next: User | null) => {
      writeUser(next);

      if (!next || next.expired || !next.access_token) {
        setIdentity(null);
        setIdentityError(null);
        setStatus("anonymous");
        return;
      }

      setStatus("bootstrapping");
      await refreshIdentity();
    },
    [refreshIdentity, writeUser],
  );

  useEffect(() => {
    const manager = getUserManager();
    let cancelled = false;

    const onUserLoaded = (loaded: User) => {
      if (!cancelled) {
        void applyUser(loaded);
      }
    };
    const onUserUnloaded = () => {
      if (!cancelled) {
        void applyUser(null);
      }
    };
    const onAccessTokenExpired = () => {
      void renewToken().then((token) => {
        if (!token && !cancelled) {
          void applyUser(null);
        }
      });
    };
    const onSilentRenewError = () => {
      if (!cancelled) {
        void applyUser(null);
      }
    };

    manager.events.addUserLoaded(onUserLoaded);
    manager.events.addUserUnloaded(onUserUnloaded);
    manager.events.addAccessTokenExpired(onAccessTokenExpired);
    manager.events.addSilentRenewError(onSilentRenewError);

    void (async () => {
      try {
        const existing = await manager.getUser();
        if (cancelled) return;
        if (existing && !existing.expired && existing.access_token) {
          await applyUser(existing);
        } else {
          // Expired or incomplete session: clear store so reload does not loop.
          if (existing) {
            try {
              await manager.removeUser();
            } catch {
              // ignore storage cleanup failures
            }
          }
          writeUser(null);
          setStatus("anonymous");
        }
      } catch {
        if (!cancelled) {
          try {
            await manager.removeUser();
          } catch {
            // ignore
          }
          writeUser(null);
          setStatus("anonymous");
        }
      }
    })();

    return () => {
      cancelled = true;
      manager.events.removeUserLoaded(onUserLoaded);
      manager.events.removeUserUnloaded(onUserUnloaded);
      manager.events.removeAccessTokenExpired(onAccessTokenExpired);
      manager.events.removeSilentRenewError(onSilentRenewError);
    };
  }, [applyUser, renewToken, writeUser]);

  const login = useCallback(async (returnPath?: string) => {
    const path = safeReturnPath(returnPath ?? `${window.location.pathname}${window.location.search}`);
    window.sessionStorage.setItem(RETURN_PATH_KEY, path);
    clearSigninRedirectCallbackCache();
    await getUserManager().signinRedirect();
  }, []);

  const completeLogin = useCallback(async () => {
    const result = await signinRedirectCallbackOnce();
    await applyUser(result);
  }, [applyUser]);

  const logout = useCallback(async () => {
    // Keep bootstrapping so ProtectedRoute does not bounce to /login?from=…
    // and auto-start a new OIDC round-trip before logout finishes.
    setStatus("bootstrapping");
    setIdentity(null);
    setIdentityError(null);
    clearSigninRedirectCallbackCache();
    markJustLoggedOut();
    writeUser(null);

    const manager = getUserManager();
    try {
      const stored = await manager.getUser();
      if (stored?.id_token) {
        // Real OIDC session: end session at the IdP, then post_logout → /login.
        await manager.signoutRedirect();
        return;
      }
      await manager.removeUser();
    } catch {
      try {
        await manager.removeUser();
      } catch {
        // ignore storage cleanup failures
      }
    }

    // Invalid/local-only session: no IdP round-trip — land on login immediately.
    setStatus("anonymous");
    window.location.assign("/login?logged_out=1");
  }, [writeUser]);

  const getAccessToken = useCallback(async () => getAuthAccessToken(), []);

  const hasRole = useCallback(
    (role: string) => {
      if (!identity) return false;
      if (identity.is_admin) return true;
      return identity.roles.includes(role);
    },
    [identity],
  );

  const hasAnyRole = useCallback(
    (roles: string[]) => roles.some((role) => hasRole(role)),
    [hasRole],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      identity,
      identityError,
      isAuthenticated: status === "authenticated" && identity !== null,
      api,
      login,
      logout,
      completeLogin,
      renewToken,
      getAccessToken,
      refreshIdentity,
      hasRole,
      hasAnyRole,
    }),
    [
      status,
      user,
      identity,
      identityError,
      api,
      login,
      logout,
      completeLogin,
      renewToken,
      getAccessToken,
      refreshIdentity,
      hasRole,
      hasAnyRole,
    ],
  );

  return createElement(AuthContext.Provider, { value }, children);
}
