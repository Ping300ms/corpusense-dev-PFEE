import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import useAppNavigation from '@/hooks/useAppNavigation.tsx';
import { useAuth } from '@/hooks/useAuth';

const LoginPage = () => {
  const { t } = useTranslation();
  const navigate = useAppNavigation();
  const { login, loginWithProvider, loading, error, setError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error: loginError } = await login(email, password);
    if (!loginError) {
      await navigate.goToHome();
    }
  };

  const handleOAuth = async (provider: 'github' | 'google' | 'gitlab' | 'azure') => {
    setError(null);
    await loginWithProvider(provider);
  };

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

          {error !== null && (
            <div className="text-red-600 text-sm">
              {error}
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

          {/* OAuth Buttons */}
          <div className="space-y-3">
            <Button
              type="button"
              onClick={() => void handleOAuth('github')}
              className="w-full bg-gray-800 text-white hover:bg-gray-700"
              disabled={loading}
            >
              {t('form_oauth_github')}
            </Button>

            <Button
              type="button"
              onClick={() => void handleOAuth('google')}
              className="w-full bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:hover:bg-gray-600"
              disabled={loading}
            >
              Connectez-vous via Google
            </Button>

            <div className="space-y-3">
              <Button
                type="button"
                onClick={() => void handleOAuth('gitlab')}
                className="w-full bg-orange-600 text-white hover:bg-orange-700"
                disabled={loading}
              >
                Connectez-vous via GitLab
              </Button>
            </div>
            <Button
              type="button"
              onClick={() => void handleOAuth('azure')}
              className="w-full bg-blue-700 text-white hover:bg-blue-800"
              disabled={loading}
            >
              Connectez-vous via Azure
            </Button>
          </div>

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
