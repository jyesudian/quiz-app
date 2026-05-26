import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { UserProfile } from '../types';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<any>(null);

  // 1. Listen for auth session changes synchronously to avoid deadlocks
  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      console.log('initializeAuth started');
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        console.log('initializeAuth session retrieved:', initialSession?.user?.email);
        if (mounted) {
          setSession(initialSession);
          if (!initialSession) {
            console.log('No initial session, setting isLoading to false');
            setIsLoading(false);
          }
        }
      } catch (err) {
        console.error('initializeAuth session error:', err);
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.log('onAuthStateChange fired event:', event, 'user:', newSession?.user?.email);
      if (mounted) {
        setSession(newSession);
        if (event === 'SIGNED_OUT') {
          console.log('onAuthStateChange: SIGNED_OUT, resetting state');
          setUser(null);
          setIsLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // 2. Fetch profile asynchronously when the session user changes
  useEffect(() => {
    if (!session?.user) {
      setUser(null);
      return;
    }

    const loadProfile = async () => {
      console.log('loadProfile starting for:', session.user.email);
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', session.user.id)
          .single();

        if (error) {
          console.error('loadProfile query error:', error);
          throw error;
        }

        console.log('loadProfile success, profile data:', data);
        setUser({
          id: session.user.id,
          name: data.full_name || session.user.email || '',
          role: data.role as 'student' | 'admin',
        });
      } catch (err) {
        console.error('loadProfile caught error:', err);
        setUser({
          id: session.user.id,
          name: session.user.email || 'Unknown',
          role: 'student',
        });
      } finally {
        console.log('loadProfile completed, setting isLoading to false');
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [session?.user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
