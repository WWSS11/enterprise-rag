/**
 * Mutable session holder for request-time token access.
 * Updated only from AuthProvider event handlers / effects — never logged.
 */
export type AuthSession = {
  accessToken: string | null;
};

export const authSession: AuthSession = {
  accessToken: null,
};

export function setAuthAccessToken(token: string | null): void {
  authSession.accessToken = token;
}

export function getAuthAccessToken(): string | null {
  return authSession.accessToken;
}
