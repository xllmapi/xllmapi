import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-text-muted">Loading…</span>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/auth" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
