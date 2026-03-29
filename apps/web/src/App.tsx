import { Component, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthContext, useAuthProvider } from "@/hooks/useAuth";
import { Header } from "@/components/layout/Header";
import { SiteBanner } from "@/components/layout/SiteBanner";
import { ProtectedRoute } from "@/components/shared/ProtectedRoute";
import { AdminRoute } from "@/components/shared/AdminRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="max-w-lg text-center">
            <h2 className="text-lg font-semibold text-text-primary mb-2">Something went wrong</h2>
            <pre className="text-xs text-danger bg-danger/10 rounded-lg p-4 text-left overflow-auto max-h-40 mb-4">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="rounded-lg border border-accent/30 text-accent px-4 py-2 text-sm hover:bg-accent/10 cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";
import { ChatProvider } from "@/hooks/useChatContext";

// Eager: landing + auth (first paint)
import { HomePage } from "@/pages/HomePage";
import { AuthPage } from "@/pages/AuthPage";
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })));
const ConfirmEmailChangePage = lazy(() => import("@/pages/ConfirmEmailChangePage").then((m) => ({ default: m.ConfirmEmailChangePage })));

// Lazy: everything else
const ChatPage = lazy(() => import("@/pages/chat/ChatPage").then((m) => ({ default: m.ChatPage })));
const ModelsPage = lazy(() => import("@/pages/ModelsPage").then((m) => ({ default: m.ModelsPage })));
const ModelDetailPage = lazy(() => import("@/pages/ModelDetailPage").then((m) => ({ default: m.ModelDetailPage })));
const OverviewPage = lazy(() => import("@/pages/app/OverviewPage").then((m) => ({ default: m.OverviewPage })));
const InvitationsPage = lazy(() => import("@/pages/app/InvitationsPage").then((m) => ({ default: m.InvitationsPage })));
const ProfilePage = lazy(() => import("@/pages/app/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const SecurityPage = lazy(() => import("@/pages/app/SecurityPage").then((m) => ({ default: m.SecurityPage })));
const ApiKeysPage = lazy(() => import("@/pages/app/ApiKeysPage").then((m) => ({ default: m.ApiKeysPage })));
const NotificationsPage = lazy(() => import("@/pages/app/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const AdminOverviewPage = lazy(() => import("@/pages/admin/AdminOverviewPage").then((m) => ({ default: m.AdminOverviewPage })));
const UsersPage = lazy(() => import("@/pages/admin/UsersPage").then((m) => ({ default: m.UsersPage })));
const AdminInvitationsPage = lazy(() => import("@/pages/admin/AdminInvitationsPage").then((m) => ({ default: m.AdminInvitationsPage })));
const ReviewsPage = lazy(() => import("@/pages/admin/ReviewsPage").then((m) => ({ default: m.ReviewsPage })));
const UsagePage = lazy(() => import("@/pages/admin/UsagePage").then((m) => ({ default: m.UsagePage })));
const SettingsPage = lazy(() => import("@/pages/admin/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ProvidersPage = lazy(() => import("@/pages/admin/ProvidersPage").then((m) => ({ default: m.ProvidersPage })));
const AdminNotificationsPage = lazy(() => import("@/pages/admin/AdminNotificationsPage").then((m) => ({ default: m.AdminNotificationsPage })));
const AdminEmailDeliveriesPage = lazy(() => import("@/pages/admin/AdminEmailDeliveriesPage").then((m) => ({ default: m.AdminEmailDeliveriesPage })));
const AdminSecurityEventsPage = lazy(() => import("@/pages/admin/AdminSecurityEventsPage").then((m) => ({ default: m.AdminSecurityEventsPage })));
const AdminRequestsPage = lazy(() => import("@/pages/admin/AdminRequestsPage").then((m) => ({ default: m.AdminRequestsPage })));
const AdminSettlementsPage = lazy(() => import("@/pages/admin/AdminSettlementsPage").then((m) => ({ default: m.AdminSettlementsPage })));
const AdminSettlementFailuresPage = lazy(() => import("@/pages/admin/AdminSettlementFailuresPage").then((m) => ({ default: m.AdminSettlementFailuresPage })));
const AdminNodeHealthPage = lazy(() => import("@/pages/admin/AdminNodeHealthPage").then((m) => ({ default: m.AdminNodeHealthPage })));
const AdminLogsPage = lazy(() => import("@/pages/admin/AdminLogsPage").then((m) => ({ default: m.AdminLogsPage })));
const AdminReleasesPage = lazy(() => import("@/pages/admin/AdminReleasesPage").then((m) => ({ default: m.AdminReleasesPage })));
const AdminAuditPage = lazy(() => import("@/pages/admin/AdminAuditPage").then((m) => ({ default: m.AdminAuditPage })));
const AdminBannerPage = lazy(() => import("@/pages/admin/AdminBannerPage").then((m) => ({ default: m.AdminBannerPage })));
const ModelsManagePage = lazy(() => import("@/pages/app/ModelsManagePage").then((m) => ({ default: m.ModelsManagePage })));
const NodeDetailPage = lazy(() => import("@/pages/NodeDetailPage").then((m) => ({ default: m.NodeDetailPage })));
const MarketDetailPage = lazy(() => import("@/pages/MarketDetailPage").then((m) => ({ default: m.MarketDetailPage })));
const UserProfilePage = lazy(() => import("@/pages/UserProfilePage").then((m) => ({ default: m.UserProfilePage })));

function PageLoader() {
  return <div className="flex items-center justify-center min-h-[200px] text-text-tertiary text-sm">Loading…</div>;
}

export function App() {
  const auth = useAuthProvider();

  return (
    <ErrorBoundary>
    <AuthContext.Provider value={auth}>
      <ChatProvider>
      <BrowserRouter>
        <Header />
        <SiteBanner />
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/confirm-email-change" element={<ConfirmEmailChangePage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/mnetwork" element={<ModelsPage />} />
          <Route path="/mnetwork/node/:publicNodeId" element={<NodeDetailPage />} />
          <Route path="/mnetwork/:logicalModel" element={<ModelDetailPage />} />
          <Route path="/market" element={<Navigate to="/mnetwork?tab=market" replace />} />
          <Route path="/market/:offeringId" element={<MarketDetailPage />} />
          <Route path="/u/:handle" element={<UserProfilePage />} />

          <Route path="/chat" element={<ChatPage />} />

          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="models" element={<Navigate to="/app/models/connected" replace />} />
            <Route path="models/connected" element={<ModelsManagePage />} />
            <Route path="models/provided" element={<ModelsManagePage />} />
            <Route path="network" element={<Navigate to="/app/models/connected" replace />} />
            <Route path="nodes" element={<Navigate to="/app/models/connected" replace />} />
            <Route path="invitations" element={<InvitationsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
          </Route>

          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route index element={<AdminOverviewPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="invitations" element={<AdminInvitationsPage />} />
            <Route path="reviews" element={<ReviewsPage />} />
            <Route path="node-health" element={<AdminNodeHealthPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="logs" element={<AdminLogsPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="notifications" element={<AdminNotificationsPage />} />
            <Route path="email-deliveries" element={<AdminEmailDeliveriesPage />} />
            <Route path="security-events" element={<AdminSecurityEventsPage />} />
            <Route path="requests" element={<AdminRequestsPage />} />
            <Route path="settlements" element={<AdminSettlementsPage />} />
            <Route path="settlement-failures" element={<AdminSettlementFailuresPage />} />
            <Route path="audit" element={<AdminAuditPage />} />
            <Route path="banner" element={<AdminBannerPage />} />
            <Route path="releases" element={<AdminReleasesPage />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
      </ChatProvider>
    </AuthContext.Provider>
    </ErrorBoundary>
  );
}
