import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  apiJson,
  setApiKey,
  setSessionToken,
} from "@/lib/api";

export interface User {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  isLoggedIn: boolean;
  isAdmin: boolean;
  login: (params?: { token?: string | null; apiKey?: string | null; persistSessionToken?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  isLoggedIn: false,
  isAdmin: false,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function useAuthProvider(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    try {
      const result = await apiJson<{ data: User }>("/v1/auth/session");
      setUser(result.data);
    } catch {
      setSessionToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  const login = useCallback(
    async (params?: { token?: string | null; apiKey?: string | null; persistSessionToken?: boolean }) => {
      if (params?.persistSessionToken && params.token) {
        setSessionToken(params.token);
      } else {
        setSessionToken(null);
      }
      if (params?.apiKey !== undefined) {
        setApiKey(params.apiKey);
      }
      await fetchSession();
    },
    [fetchSession],
  );

  const logout = useCallback(async () => {
    try {
      await apiJson("/v1/auth/logout", { method: "POST" });
    } catch {
      // Clear local state even if the server session is already gone.
    }
    setSessionToken(null);
    setApiKey(null);
    setUser(null);
  }, []);

  return {
    user,
    loading,
    isLoggedIn: !!user,
    isAdmin: user?.role === "admin",
    login,
    logout,
    refresh: fetchSession,
  };
}

export function useAuth() {
  return useContext(AuthContext);
}
