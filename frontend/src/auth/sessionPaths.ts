export const RETURN_PATH_KEY = "evidence-desk:return-path";
export const JUST_LOGGED_OUT_KEY = "evidence-desk:just-logged-out";

export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/app/chat";
  }
  return path;
}

export function consumeReturnPath(): string {
  const stored = window.sessionStorage.getItem(RETURN_PATH_KEY);
  window.sessionStorage.removeItem(RETURN_PATH_KEY);
  return safeReturnPath(stored);
}

export function markJustLoggedOut(): void {
  window.sessionStorage.setItem(JUST_LOGGED_OUT_KEY, "1");
  window.sessionStorage.removeItem(RETURN_PATH_KEY);
}

export function consumeJustLoggedOut(): boolean {
  const value = window.sessionStorage.getItem(JUST_LOGGED_OUT_KEY);
  if (value) {
    window.sessionStorage.removeItem(JUST_LOGGED_OUT_KEY);
    return true;
  }
  return false;
}
