import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout, isTimeoutError } from '../lib/fetchWithTimeout';

const API_BASE_URL = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');
const TOKEN_STORAGE_KEY = 'dashboardsocial.authToken';

function buildApiUrl(path = '') {
  if (!path) return API_BASE_URL || '';
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

const TIMEOUT_MESSAGE = 'Tempo esgotado ao carregar dados.';

const requestWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  try {
    return await fetchWithTimeout(url, options, timeoutMs);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw err;
  }
};

async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
  const text = await response.text();
  return text ? { error: text } : {};
}

function readInitialToken() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch (err) {
    console.warn('Não foi possível ler token salvo.', err);
    return null;
  }
}

const AuthContext = createContext({
  user: null,
  role: null,
  token: null,
  loading: true,
  signInWithPassword: async () => {
    throw new Error('AuthProvider não inicializado.');
  },
  signInWithFacebook: async () => {
    throw new Error('AuthProvider não inicializado.');
  },
  signUp: async () => {
    throw new Error('AuthProvider não inicializado.');
  },
  signOut: () => undefined,
  apiFetch: async () => {
    throw new Error('AuthProvider não inicializado.');
  },
});

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readInitialToken());
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  const persistToken = useCallback((nextToken) => {
    setToken(nextToken);
    if (typeof window === 'undefined') return;
    try {
      if (nextToken) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch (err) {
      console.warn('Falha ao salvar token localmente.', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setUser(null);
      setRole(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const loadSession = async () => {
      setLoading(true);
      try {
        const response = await requestWithTimeout(buildApiUrl('/api/auth/session'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const body = await parseResponseBody(response);
        if (!response.ok) {
          throw new Error(body?.error || `Falha ao validar sessão (${response.status})`);
        }
        if (!cancelled) {
          setUser(body.user ?? null);
          setRole(body.user?.role ?? null);
        }
      } catch (err) {
        console.error('Erro ao carregar sessão autenticada.', err);
        if (!cancelled) {
          setUser(null);
          setRole(null);
          persistToken(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSession();

    return () => {
      cancelled = true;
    };
  }, [token, persistToken]);

  const signInWithPassword = useCallback(
    async (email, password) => {
      const response = await requestWithTimeout(buildApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(body?.error || 'Não foi possível entrar.');
      }
      persistToken(body.token || null);
      setUser(body.user ?? null);
      setRole(body.user?.role ?? null);
      return body;
    },
    [persistToken],
  );

  const signInWithFacebook = useCallback(
    async (accessToken) => {
      const response = await requestWithTimeout(buildApiUrl('/api/auth/facebook'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(body?.error || 'Não foi possível entrar com Facebook.');
      }
      persistToken(body.token || null);
      setUser(body.user ?? null);
      setRole(body.user?.role ?? null);
      return body;
    },
    [persistToken],
  );

  const signUp = useCallback(
    async (email, password, nome) => {
      const response = await requestWithTimeout(buildApiUrl('/api/auth/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: String(email || '').trim(),
          password,
          nome: String(nome || '').trim(),
        }),
      });
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(body?.error || 'Não foi possível criar sua conta.');
      }
      persistToken(body.token || null);
      setUser(body.user ?? null);
      setRole(body.user?.role ?? null);
      return body;
    },
    [persistToken],
  );

  const signOut = useCallback(() => {
    persistToken(null);
    setUser(null);
    setRole(null);
  }, [persistToken]);

  const apiFetch = useCallback(
    async (path, options = {}) => {
      const url = buildApiUrl(path);
      const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
      const headers = {
        Accept: 'application/json',
        ...(fetchOptions.headers || {}),
      };
      let body = fetchOptions.body;
      if (body && typeof body === 'object' && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await requestWithTimeout(url, {
        ...fetchOptions,
        headers,
        body,
      }, timeoutMs);
      const payload = await parseResponseBody(response);

      if (response.status === 401) {
        persistToken(null);
        setUser(null);
        setRole(null);
      }

      if (!response.ok) {
        const message =
          (payload && typeof payload === 'object' && payload.error) ||
          (typeof payload === 'string' ? payload : `Request failed (${response.status})`);
        throw new Error(message);
      }

      return payload;
    },
    [token, persistToken],
  );

  const value = useMemo(
    () => ({
      user,
      role,
      token,
      loading,
      signInWithPassword,
      signInWithFacebook,
      signUp,
      signOut,
      apiFetch,
    }),
    [user, role, token, loading, signInWithPassword, signInWithFacebook, signUp, signOut, apiFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
