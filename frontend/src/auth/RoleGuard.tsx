import { Navigate } from "react-router-dom";
import { useAuth } from "./useAuth";

type RoleGuardProps = {
  roles?: string[];
  requireAdmin?: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

/**
 * Authorization uses /auth/me identity only — never raw JWT claims for UI decisions.
 */
export function RoleGuard({
  roles = [],
  requireAdmin = false,
  children,
  fallback,
}: RoleGuardProps) {
  const { identity, hasAnyRole } = useAuth();

  if (!identity) {
    return <Navigate to="/login" replace />;
  }

  const allowed =
    (requireAdmin && identity.is_admin) ||
    (!requireAdmin && roles.length === 0) ||
    (roles.length > 0 && hasAnyRole(roles)) ||
    identity.is_admin;

  if (!allowed) {
    return fallback ?? <Navigate to="/403" replace />;
  }

  return children;
}
