import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab/Shift+Tab inside a container while active.
 * Sets initial focus to `initialFocusRef` or first focusable child.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previous = document.activeElement as HTMLElement | null;

    const focusInitial = () => {
      const preferred = initialFocusRef?.current;
      if (preferred && container.contains(preferred)) {
        preferred.focus();
        return;
      }
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    };

    // After paint so dialog content is queryable.
    const raf = window.requestAnimationFrame(focusInitial);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !containerRef.current) return;
      const nodes = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (current === first || !containerRef.current.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [active, containerRef, initialFocusRef]);
}

/** Lock body scroll while active. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
