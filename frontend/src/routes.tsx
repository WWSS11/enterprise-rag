import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/layouts/AppShell";
import { AppLoadingSkeleton } from "@/components/AppLoadingSkeleton";
import { LoginPage } from "@/pages/LoginPage";
import { CallbackPage } from "@/pages/CallbackPage";
import { SilentCallbackPage } from "@/pages/SilentCallbackPage";
import { ForbiddenPage, NotFoundPage } from "@/pages/StatusPages";
import { SystemPage } from "@/pages/SystemPage";

const ChatPage = lazy(() =>
  import("@/pages/ChatPage").then((module) => ({ default: module.ChatPage })),
);
const KnowledgeBasesPage = lazy(() =>
  import("@/pages/KnowledgeBasesPage").then((module) => ({ default: module.KnowledgeBasesPage })),
);
const CreateKnowledgeBasePage = lazy(() =>
  import("@/pages/CreateKnowledgeBasePage").then((module) => ({
    default: module.CreateKnowledgeBasePage,
  })),
);
const KnowledgeBaseDetailPage = lazy(() =>
  import("@/pages/KnowledgeBaseDetailPage").then((module) => ({
    default: module.KnowledgeBaseDetailPage,
  })),
);
const DocumentsPage = lazy(() =>
  import("@/pages/DocumentsPage").then((module) => ({ default: module.DocumentsPage })),
);
const JobsPage = lazy(() =>
  import("@/pages/JobsPage").then((module) => ({ default: module.JobsPage })),
);
const EvaluationsPage = lazy(() =>
  import("@/pages/EvaluationsPage").then((module) => ({ default: module.EvaluationsPage })),
);
const CreateEvaluationDatasetPage = lazy(() =>
  import("@/pages/CreateEvaluationDatasetPage").then((module) => ({
    default: module.CreateEvaluationDatasetPage,
  })),
);
const EvaluationDatasetPage = lazy(() =>
  import("@/pages/EvaluationDatasetPage").then((module) => ({
    default: module.EvaluationDatasetPage,
  })),
);
const EvaluationRunPage = lazy(() =>
  import("@/pages/EvaluationRunPage").then((module) => ({
    default: module.EvaluationRunPage,
  })),
);
const FeishuConnectorPage = lazy(() =>
  import("@/pages/FeishuConnectorPage").then((module) => ({
    default: module.FeishuConnectorPage,
  })),
);

function LazyRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  return <Suspense fallback={<AppLoadingSkeleton label={t("loading")} />}>{children}</Suspense>;
}

function ChatRoute() {
  return (
    <LazyRoute>
      <ChatPage />
    </LazyRoute>
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
        <Route
          path="knowledge-bases"
          element={<LazyRoute><KnowledgeBasesPage /></LazyRoute>}
        />
        <Route
          path="knowledge-bases/new"
          element={<LazyRoute><CreateKnowledgeBasePage /></LazyRoute>}
        />
        <Route
          path="knowledge-bases/:knowledgeBaseId"
          element={<LazyRoute><KnowledgeBaseDetailPage /></LazyRoute>}
        />
        <Route path="documents" element={<LazyRoute><DocumentsPage /></LazyRoute>} />
        <Route
          path="evaluations"
          element={<LazyRoute><EvaluationsPage /></LazyRoute>}
        />
        <Route
          path="evaluations/new"
          element={<LazyRoute><CreateEvaluationDatasetPage /></LazyRoute>}
        />
        <Route
          path="evaluations/datasets/:datasetId"
          element={<LazyRoute><EvaluationDatasetPage /></LazyRoute>}
        />
        <Route
          path="evaluations/runs/:runId"
          element={<LazyRoute><EvaluationRunPage /></LazyRoute>}
        />
        <Route path="jobs" element={<LazyRoute><JobsPage /></LazyRoute>} />
        <Route
          path="connectors/feishu"
          element={<LazyRoute><FeishuConnectorPage /></LazyRoute>}
        />
        <Route path="system" element={<SystemPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
