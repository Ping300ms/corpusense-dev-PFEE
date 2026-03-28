import { useState } from 'react';
import * as auth from '@/lib/authService';

export const useAuth = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    const res = await auth.loginWithPassword(email, password);
    if (res.error) setError(res.error.message);
    setLoading(false);
    return res;
  };

  const loginWithProvider = async (
    provider: 'google' | 'github' | 'gitlab' | 'azure'
  ) => {
    setLoading(true);
    setError(null);
    const res = await auth.loginWithOAuth(provider);
    if (res.error) setError(res.error.message);
    setLoading(false);
    return res;
  };

  return {
    login,
    loginWithProvider,
    loading,
    error,
    setError,
  };
};
