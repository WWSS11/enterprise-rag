/** UI-only preferences in localStorage — never tokens. */
export const SIDEBAR_COLLAPSED_KEY = "evidence-desk:sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}
