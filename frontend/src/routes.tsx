import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/layouts/AppShell";
import { AppLoadingSkeleton } from "@/components/AppLoadingSkeleton";
import { LoginPage } from "@/pages/LoginPage";
import { CallbackPage } from "@/pages/CallbackPage";
import { SilentCallbackPage } from "@/pages/SilentCallbackPage";
import { ForbiddenPage, NotFoundPage } from "@/pages/StatusPages";
import {
  DocumentsPage,
  EvaluationsPage,
  JobsPage,
  KnowledgeBasesPage,
} from "@/pages/RoutePlaceholders";
import { SystemPage } from "@/pages/SystemPage";

const ChatPage = lazy(() =>
  import("@/pages/ChatPage").then((module) => ({ default: module.ChatPage })),
);

function ChatRoute() {
  const { t } = useTranslation("common");
  return (
    <Suspense fallback={<AppLoadingSkeleton label={t("loading")} />}>
      <ChatPage />
    </Suspense>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/chat" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route path="/auth/silent-callback" element={<SilentCallbackPage />} />
      <Route path="/403" element={<ForbiddenPage />} />

      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="chat" replace />} />
        <Route path="chat" element={<ChatRoute />} />
        <Route path="knowledge-bases" element={<KnowledgeBasesPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="evaluations" element={<EvaluationsPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="system" element={<SystemPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
