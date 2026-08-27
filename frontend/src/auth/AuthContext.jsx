/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, coachesApi, onUnauthorized, setStoredToken, getStoredToken, clearStoredToken } from '../api/index.js';
import { computeCoachReadiness, hasAdminRole, hasCoachRole, hasStudentRole } from '../domain/userReadiness.js';
import { detectLocalTimezone } from '../utils/datetime.js';

const AuthContext = createContext(null);
const MODE_KEY = 'pc.mode';

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}

function writeMode(mode) {
  try {
    if (mode) localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
}

function inferMode(user, preferred) {
  const roles = user?.roles || [];
  if (preferred && roles.includes(preferred)) return preferred;
  if (hasStudentRole(roles)) return 'student';
  if (hasCoachRole(roles)) return 'coach';
  if (hasAdminRole(roles)) return 'admin';
  return 'student';
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(null);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [mode, setModeState] = useState(() => readMode());
  const [bootstrapping, setBootstrapping] = useState(Boolean(getStoredToken()));
  const [authError, setAuthError] = useState(null);

  const clearSession = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setStripeStatus(null);
  }, []);

  const applySession = useCallback(async (nextToken, sessionUser) => {
    setStoredToken(nextToken);
    setToken(nextToken);
    if (sessionUser?.id && !sessionUser.coachProfile) {
      const profile = await authApi.getProfile();
      setUser(profile.data);
      setModeState((prev) => inferMode(profile.data, prev || readMode()));
      return profile.data;
    }
    if (sessionUser) {
      setUser(sessionUser);
      setModeState((prev) => inferMode(sessionUser, prev || readMode()));
    }
    return sessionUser;
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await authApi.getProfile();
    setUser(data);
    return data;
  }, []);

  const refreshStripeStatus = useCallback(async () => {
    if (!hasCoachRole(user?.roles)) {
      setStripeStatus(null);
      return null;
    }
    try {
      const { data } = await coachesApi.stripeStatus();
      setStripeStatus(data);
      return data;
    } catch {
      setStripeStatus(null);
      return null;
    }
  }, [user?.roles]);

  useEffect(() => {
    onUnauthorized(() => {
      clearSession();
    });
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const existing = getStoredToken();
      if (!existing) {
        setBootstrapping(false);
        return;
      }
      try {
        const { data } = await authApi.getProfile({ ignoreUnauthorized: true });
        if (cancelled) return;
        setUser(data);
        setModeState((prev) => inferMode(data, prev || readMode()));
      } catch (err) {
        if (cancelled) return;
        if (err.status === 401) {
          try {
            const refreshed = await authApi.refresh(existing);
            if (cancelled) return;
            await applySession(refreshed.data.token, refreshed.data.user);
            const profile = await authApi.getProfile({ ignoreUnauthorized: true });
            if (cancelled) return;
            setUser(profile.data);
          } catch {
            clearSession();
          }
        } else {
          setAuthError(err.message);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  useEffect(() => {
    if (user && hasCoachRole(user.roles)) {
      refreshStripeStatus();
    }
  }, [user, refreshStripeStatus]);

  useEffect(() => {
    writeMode(mode);
  }, [mode]);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await authApi.login({ email, password });
    const profile = await applySession(data.token, data.user);
    try {
      const full = await authApi.getProfile();
      setUser(full.data);
      setModeState((prev) => inferMode(full.data, prev || readMode()));
      return full.data;
    } catch {
      return profile;
    }
  }, [applySession]);

  const register = useCallback(async (body) => {
    const timezone = body.timezone || detectLocalTimezone();
    const { data } = await authApi.register({ ...body, timezone });
    await applySession(data.token, data.user);
    try {
      const full = await authApi.getProfile();
      setUser(full.data);
      setModeState(body.role === 'coach' ? 'coach' : inferMode(full.data, body.role));
      return full.data;
    } catch {
      setModeState(body.role === 'coach' ? 'coach' : 'student');
      return data.user;
    }
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      if (getStoredToken()) await authApi.logout();
    } catch {
      /* still clear locally */
    }
    clearSession();
  }, [clearSession]);

  const setMode = useCallback((next) => {
    setModeState(next);
    writeMode(next);
  }, []);

  const readiness = useMemo(
    () => computeCoachReadiness(user, stripeStatus),
    [user, stripeStatus],
  );

  const value = useMemo(
    () => ({
      token,
      user,
      mode: inferMode(user, mode),
      setMode,
      bootstrapping,
      authError,
      stripeStatus,
      readiness,
      isAuthenticated: Boolean(token && user),
      login,
      register,
      logout,
      refreshProfile,
      refreshStripeStatus,
      applySession,
    }),
    [
      token,
      user,
      mode,
      setMode,
      bootstrapping,
      authError,
      stripeStatus,
      readiness,
      login,
      register,
      logout,
      refreshProfile,
      refreshStripeStatus,
      applySession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
