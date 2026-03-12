import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  apiJson,
  getSessionToken,
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
  login: (token: string, apiKey?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  isLoggedIn: false,
  isAdmin: false,
  login: async () => {},
  logout: () => {},
  refresh: async () => {},
});

export function useAuthProvider(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    const token = getSessionToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
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
    async (token: string, apiKey?: string) => {
      setSessionToken(token);
      if (apiKey) setApiKey(apiKey);
      await fetchSession();
    },
    [fetchSession],
  );

  const logout = useCallback(() => {
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
