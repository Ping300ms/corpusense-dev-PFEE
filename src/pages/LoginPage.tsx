import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/data/repositories/supabase/supabaseClient.ts';
import useAppNavigation from '@/hooks/useAppNavigation.tsx';

const LoginPage = () => {
  const { t } = useTranslation();
  const navigate = useAppNavigation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMsg(error.message);
    } else {
      await navigate.goToHome();
    }

    setLoading(false);
  };

  const handleOAuth = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'github' })
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-md w-full max-w-md">
        <h1 className="text-2xl font-semibold text-center text-gray-800 dark:text-white mb-6">
          {t('page_title_login')}
        </h1>
        <form onSubmit={(e) => void handleLogin(e)} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('form_label_email')}
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('form_label_password')}
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>
          {(errorMsg != null) && (
            <div className="text-red-600 text-sm">
              {errorMsg}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={loading}
            title={t('btn_login')}
          >
            {loading ? t('loading') : t('btn_login')}
          </Button>
          <Button
            onClick={() => void handleOAuth()}
            className="w-full bg-gray-800 text-white hover:bg-gray-700"
          >
            {t('form_oauth_github')}
          </Button>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400 text-center">
            {t('no_account')}{' '}
            <Link to="/register" className="text-blue-500 hover:underline">
              {t('btn_register')}
            </Link>
          </p>
        </form>

      </div>
    </div>
  );
};

export default LoginPage;
