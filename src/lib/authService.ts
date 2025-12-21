import { supabase } from '@/utils/config';

export const loginWithPassword = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password });

export const loginWithOAuth = (
  provider: 'google' | 'github' | 'gitlab' | 'azure'
) =>
  supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/`,
    },
  });

export const logout = () => supabase.auth.signOut();
