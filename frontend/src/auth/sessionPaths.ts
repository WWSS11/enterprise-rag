export const RETURN_PATH_KEY = "evidence-desk:return-path";
export const JUST_LOGGED_OUT_KEY = "evidence-desk:just-logged-out";
const DEFAULT_RETURN_PATH = "/app/chat";

export function safeReturnPath(path: string | null | undefined): string {
  const containsControlCharacter = path
    ? [...path].some((character) => character.charCodeAt(0) < 32)
    : false;
  if (
    !path ||
    path.length > 2048 ||
    !path.startsWith("/") ||
    path.includes("\\") ||
    containsControlCharacter
  ) {
    return DEFAULT_RETURN_PATH;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (decoded.startsWith("//") || decoded.includes("\\")) {
    return DEFAULT_RETURN_PATH;
  }
  const parsed = new URL(path, window.location.origin);
  if (parsed.origin !== window.location.origin || !/^\/app(?:\/|$)/.test(parsed.pathname)) {
    return DEFAULT_RETURN_PATH;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
