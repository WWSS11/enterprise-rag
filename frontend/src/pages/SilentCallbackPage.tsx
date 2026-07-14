import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getUserManager } from "@/auth/userManager";
import { AppLoadingSkeleton } from "@/components/AppLoadingSkeleton";

/**
 * Hidden iframe / popup target for silent renew.
 * Must call signinSilentCallback and exit without rendering app chrome.
 */
export function SilentCallbackPage() {
  const { t } = useTranslation("auth");

  useEffect(() => {
    void getUserManager()
      .signinSilentCallback()
      .catch(() => {
        // Silent renew failures are handled by AuthProvider events.
      });
  }, []);

  return <AppLoadingSkeleton label={t("renewingSession")} />;
}
