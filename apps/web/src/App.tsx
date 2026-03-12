import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthContext, useAuthProvider } from "@/hooks/useAuth";
import { Header } from "@/components/layout/Header";
import { ProtectedRoute } from "@/components/shared/ProtectedRoute";
import { AdminRoute } from "@/components/shared/AdminRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";

import { HomePage } from "@/pages/HomePage";
import { AuthPage } from "@/pages/AuthPage";
import { DocsPage } from "@/pages/DocsPage";
import { ChatPage } from "@/pages/chat/ChatPage";
import { ModelsPage } from "@/pages/ModelsPage";
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
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/models" element={<ModelsPage />} />

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
    </AuthContext.Provider>
  );
}
