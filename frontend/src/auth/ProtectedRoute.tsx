import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./useAuth";
import { AppLoadingSkeleton } from "@/components/AppLoadingSkeleton";
import { IdentityErrorPanel } from "@/components/IdentityErrorPanel";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("auth");
  const { status, isAuthenticated, identityError, refreshIdentity, logout } = useAuth();
  const location = useLocation();

  if (status === "bootstrapping") {
    return <AppLoadingSkeleton label={t("restoringSession")} />;
  }

  if (status === "identity_error") {
    return (
      <IdentityErrorPanel
        error={identityError}
        onRetry={() => void refreshIdentity()}
        onLogout={() => void logout()}
      />
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
