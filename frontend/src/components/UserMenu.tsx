import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { formatRoleLabel } from "@/i18n/format";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { CopyableValue } from "./CopyableValue";
import styles from "./UserMenu.module.css";

function initials(userId: string): string {
  const cleaned = userId.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

export function UserMenu() {
  const { t } = useTranslation();
  const { identity, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useFocusTrap(open, panelRef, firstFocusRef);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!identity) {
    return null;
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t("auth:user")}: ${identity.user_id}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(identity.user_id)}
        </span>
        <span className={styles.name} aria-hidden="true">
          {identity.user_id}
        </span>
      </button>

      {open ? (
        <div
          className={styles.menu}
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("auth:user")}
        >
          <div className={styles.section}>
            <div className={styles.sectionLabel}>{t("auth:user")}</div>
            <CopyableValue value={identity.user_id} />
          </div>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>{t("auth:tenant")}</div>
            <CopyableValue value={identity.tenant_id} />
          </div>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>{t("auth:roles")}</div>
            <div className={styles.chips}>
              {identity.roles.length === 0 ? (
                <span className={styles.chip}>{t("common:none")}</span>
              ) : (
                identity.roles.map((role) => (
                  <span key={role} className={styles.chip} title={role}>
                    {formatRoleLabel((key, options) => t(key, options), role)}
                  </span>
                ))
              )}
              {identity.is_admin ? (
                <span className={styles.chip} title="admin">
                  {t("auth:admin")}
                </span>
              ) : null}
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>{t("auth:groups")}</div>
            <div className={styles.chips}>
              {identity.groups.length === 0 ? (
                <span className={styles.chip}>{t("common:none")}</span>
              ) : (
                identity.groups.map((group) => (
                  <span key={group} className={`${styles.chip} ${styles.chipMono}`} title={group}>
                    {group}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>{t("auth:authMethod")}</div>
            <div className={styles.monoLine}>{identity.auth_method}</div>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              ref={firstFocusRef}
              className={`${styles.item} ${styles.itemDanger}`}
              onClick={() => void logout()}
            >
              {t("common:signOut")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
