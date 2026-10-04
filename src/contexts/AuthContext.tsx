import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { clearSessionData } from '../services/sessionCache';
import { supabase } from '../services/supabase';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function supabaseUserToLocal(supabaseUser: SupabaseUser): User {
  return {
    id: supabaseUser.id,
    name: supabaseUser.email ?? supabaseUser.id,
    createdAt: supabaseUser.created_at ?? new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    let identity: string | null = localStorage.getItem('trackr:session-owner');
    // Supabase manages its own session. Remove the former token copies.
    for (const key of ['access_token', 'authToken', 'user']) localStorage.removeItem(key);
    const applySession = (next: SupabaseUser | null) => {
      if (!mounted) return;
      if (identity !== (next?.id ?? null)) clearSessionData();
      identity = next?.id ?? null;
      if (identity) localStorage.setItem('trackr:session-owner', identity);
      else localStorage.removeItem('trackr:session-owner');
      if (!next) clearSessionData();
      setUser(next ? supabaseUserToLocal(next) : null);
      setIsLoading(false);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      revision++;
      applySession(session?.user ?? null);
    });
    const requestedRevision = revision;
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (revision === requestedRevision) applySession(error ? null : session?.user ?? null);
    }).catch(() => { if (revision === requestedRevision) applySession(null); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const register = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    clearSessionData();
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
