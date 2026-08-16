import { NavLink, Outlet } from "react-router-dom";
import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { ApiHealth } from "@/components/ApiHealth";
import { UserMenu } from "@/components/UserMenu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  IconChat,
  IconClose,
  IconDocument,
  IconEval,
  IconJobs,
  IconLibrary,
  IconMenu,
  IconSystem,
} from "@/components/icons";
import { useBodyScrollLock, useFocusTrap } from "@/hooks/useFocusTrap";
import { readSidebarCollapsed, writeSidebarCollapsed } from "@/hooks/uiPrefs";
import styles from "./AppShell.module.css";

type IconComp = ComponentType<SVGProps<SVGSVGElement>>;

const NAV_ITEMS: { to: string; key: "chat" | "knowledgeBases" | "documents" | "evaluations" | "jobs" | "connectors" | "system"; icon: IconComp; adminOnly?: boolean }[] = [
  { to: "/app/chat", key: "chat", icon: IconChat },
  { to: "/app/knowledge-bases", key: "knowledgeBases", icon: IconLibrary },
  { to: "/app/documents", key: "documents", icon: IconDocument },
  { to: "/app/evaluations", key: "evaluations", icon: IconEval },
  { to: "/app/jobs", key: "jobs", icon: IconJobs },
  { to: "/app/connectors/feishu", key: "connectors", icon: IconSystem, adminOnly: true },
  { to: "/app/system", key: "system", icon: IconSystem },
];

function NavItems({
  collapsed,
  onNavigate,
  showAdmin,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  showAdmin: boolean;
}) {
  const { t } = useTranslation("navigation");

  return (
    <nav className={styles.nav} aria-label={t("primaryNav")}>
      {NAV_ITEMS.filter((item) => !item.adminOnly || showAdmin).map((item) => {
        const label = t(item.key);
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                styles.navLink,
                isActive ? styles.navLinkActive : "",
              ]
                .filter(Boolean)
                .join(" ")
            }
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            onClick={onNavigate}
          >
            <span className={styles.navIcon} aria-hidden="true">
              <Icon />
            </span>
            <span className={styles.navLabel}>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const { t } = useTranslation(["common", "auth", "navigation"]);
  const { identity } = useAuth();
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== "undefined" ? readSidebarCollapsed() : false,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTitleId = useId();
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useFocusTrap(mobileOpen, drawerRef, closeBtnRef);
  useBodyScrollLock(mobileOpen);

  useEffect(() => {
    writeSidebarCollapsed(collapsed);
  }, [collapsed]);

  const openMobile = useCallback(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setMobileOpen(true);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    // Focus restore is handled solely by useFocusTrap cleanup.
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobile();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, closeMobile]);

  const tenantId = identity?.tenant_id;
  const showAdmin = Boolean(identity?.is_admin);

  return (
    <div
      className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ""}`}
      data-mobile-nav-open={mobileOpen ? "true" : "false"}
    >
      <aside
        className={styles.sidebar}
        aria-label={t("navigation:application")}
        inert={mobileOpen ? true : undefined}
      >
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true">
            ED
          </div>
          <div className={styles.brandText}>
            <div className={styles.brandTitle}>{t("common:brandName")}</div>
            <div className={styles.brandSubtitle}>{t("common:brandProduct")}</div>
          </div>
        </div>

        <NavItems collapsed={collapsed} showAdmin={showAdmin} />

        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={() => setCollapsed((value) => !value)}
            aria-pressed={collapsed}
            aria-label={collapsed ? t("navigation:expandSidebar") : t("navigation:collapseSidebar")}
          >
            <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
            <span className={styles.collapseLabel}>
              {collapsed ? t("navigation:expand") : t("navigation:collapse")}
            </span>
          </button>
        </div>
      </aside>

      <header className={styles.header} inert={mobileOpen ? true : undefined}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            ref={menuBtnRef}
            className={styles.menuBtn}
            aria-label={t("navigation:openNavigation")}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            onClick={openMobile}
          >
            <IconMenu />
          </button>
          <div className={styles.metaStrip} aria-label={t("navigation:sessionContext")}>
            {tenantId ? (
              <span className={styles.metaChip}>
                <span className={styles.metaLabel}>{t("auth:tenant")}</span>
                <span className={styles.metaValue} title={tenantId}>
                  {tenantId}
                </span>
              </span>
            ) : null}
            {showAdmin ? (
              <span className={styles.metaChip}>
                <span className={styles.metaLabel}>{t("auth:access")}</span>
                <span className={styles.metaValue}>{t("auth:admin")}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className={styles.headerRight}>
          <LanguageSwitcher compact />
          <ApiHealth />
          <UserMenu />
        </div>
      </header>

      <main
        id="main-content"
        className={styles.main}
        tabIndex={-1}
        inert={mobileOpen ? true : undefined}
      >
        <div className={styles.mainInner}>
          <Outlet />
        </div>
      </main>

      {mobileOpen ? (
        <>
          <div
            className={styles.overlay}
            aria-hidden="true"
            onClick={closeMobile}
          />
          <div
            id="mobile-nav-drawer"
            className={styles.mobileDrawer}
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={mobileTitleId}
          >
            <div className={styles.drawerHeader}>
              <div className={styles.brandText}>
                <div className={styles.brandTitle} id={mobileTitleId}>
                  {t("common:brandName")}
                </div>
                <div className={styles.brandSubtitle}>{t("navigation:navigation")}</div>
              </div>
              <button
                type="button"
                ref={closeBtnRef}
                className={styles.drawerClose}
                onClick={closeMobile}
                aria-label={t("navigation:closeNavigation")}
              >
                <IconClose />
              </button>
            </div>
            <NavItems collapsed={false} showAdmin={showAdmin} onNavigate={closeMobile} />
          </div>
        </>
      ) : null}
    </div>
  );
}
