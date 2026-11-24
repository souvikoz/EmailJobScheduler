import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AuthConfig, SlackStatus, User } from '../types';

interface AuthContextValue {
  user: User | null;
  authConfig: AuthConfig;
  slackStatus: SlackStatus;
  loading: boolean;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  refreshUser: () => Promise<void>;
  refreshSlackStatus: () => Promise<void>;
  logout: () => Promise<void>;
}

const defaultAuthConfig: AuthConfig = {
  googleOAuthEnabled: false,
  slackOAuthEnabled: false,
};

const defaultSlackStatus: SlackStatus = {
  connected: false,
  slackOAuthEnabled: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>(defaultAuthConfig);
  const [slackStatus, setSlackStatus] = useState<SlackStatus>(defaultSlackStatus);
  const [loading, setLoading] = useState(true);

  const refreshSlackStatus = useCallback(async () => {
    try {
      const status = await api.getSlackStatus();
      setSlackStatus(status);
    } catch {
      setSlackStatus((prev) => ({ ...prev, connected: false }));
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const [{ user: me }, cfg] = await Promise.all([api.getMe(), api.getAuthConfig()]);
      setUser(me);
      setAuthConfig(cfg);
      await refreshSlackStatus();
    } catch {
      setUser(null);
      try {
        const cfg = await api.getAuthConfig();
        setAuthConfig(cfg);
      } catch {
        // Ignore config error if backend is temporarily unreachable
      }
    } finally {
      setLoading(false);
    }
  }, [refreshSlackStatus]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setSlackStatus(defaultSlackStatus);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authConfig,
        slackStatus,
        loading,
        setUser,
        refreshUser,
        refreshSlackStatus,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
