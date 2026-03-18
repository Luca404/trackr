import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
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

function supabaseUserToLocal(supabaseUser: any): User {
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
    // Controlla la sessione attiva all'avvio
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const localUser = supabaseUserToLocal(session.user);
        setUser(localUser);
        localStorage.setItem('access_token', session.access_token);
        localStorage.setItem('authToken', session.access_token);
        localStorage.setItem('user', JSON.stringify(localUser));
      }
      setIsLoading(false);
    });

    // Ascolta i cambiamenti di sessione (login, logout, refresh token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const localUser = supabaseUserToLocal(session.user);
        setUser(localUser);
        localStorage.setItem('access_token', session.access_token);
        localStorage.setItem('authToken', session.access_token);
        localStorage.setItem('user', JSON.stringify(localUser));
      } else {
        setUser(null);
        localStorage.removeItem('access_token');
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
      }
    });

    return () => subscription.unsubscribe();
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
    await supabase.auth.signOut();
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
