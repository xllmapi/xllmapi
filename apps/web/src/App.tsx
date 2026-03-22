import { Component, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthContext, useAuthProvider } from "@/hooks/useAuth";
import { Header } from "@/components/layout/Header";
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

import { HomePage } from "@/pages/HomePage";
import { AuthPage } from "@/pages/AuthPage";
import { DocsPage } from "@/pages/DocsPage";
import { ChatPage } from "@/pages/chat/ChatPage";
import { ChatProvider } from "@/hooks/useChatContext";
import { ModelsPage } from "@/pages/ModelsPage";
import { ModelDetailPage } from "@/pages/ModelDetailPage";
import { OverviewPage } from "@/pages/app/OverviewPage";
import { NetworkPage } from "@/pages/app/NetworkPage";
import { InvitationsPage } from "@/pages/app/InvitationsPage";
import { ProfilePage } from "@/pages/app/ProfilePage";
import { SecurityPage } from "@/pages/app/SecurityPage";
import { AdminOverviewPage } from "@/pages/admin/AdminOverviewPage";
import { UsersPage } from "@/pages/admin/UsersPage";
import { AdminInvitationsPage } from "@/pages/admin/AdminInvitationsPage";
import { ReviewsPage } from "@/pages/admin/ReviewsPage";
import { UsagePage } from "@/pages/admin/UsagePage";

export function App() {
  const auth = useAuthProvider();

  return (
    <ErrorBoundary>
    <AuthContext.Provider value={auth}>
      <ChatProvider>
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/mnetwork" element={<ModelsPage />} />
          <Route path="/mnetwork/:logicalModel" element={<ModelDetailPage />} />

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
            <Route path="network" element={<NetworkPage />} />
            <Route path="invitations" element={<InvitationsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="security" element={<SecurityPage />} />
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
            <Route path="usage" element={<UsagePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ChatProvider>
    </AuthContext.Provider>
    </ErrorBoundary>
  );
}
