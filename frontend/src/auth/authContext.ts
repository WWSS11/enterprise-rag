import { createContext } from "react";
import type { User } from "oidc-client-ts";
import type { ApiClient } from "@/api/client";
import type { ApiError } from "@/api/errors";
import type { CurrentIdentity } from "@/api/types";

export type AuthStatus =
  | "bootstrapping"
  | "anonymous"
  | "authenticated"
  | "identity_error";

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  identity: CurrentIdentity | null;
  identityError: ApiError | Error | null;
  isAuthenticated: boolean;
  api: ApiClient;
  login: (returnPath?: string) => Promise<void>;
  logout: () => Promise<void>;
  completeLogin: () => Promise<void>;
  renewToken: () => Promise<string | null>;
  getAccessToken: () => Promise<string | null>;
  refreshIdentity: () => Promise<CurrentIdentity | null>;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
