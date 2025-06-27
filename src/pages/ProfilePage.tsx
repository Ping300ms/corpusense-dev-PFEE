import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

const ProfilePage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async () => {
    await navigate('/login');
  }

  if (!user){
    return (
      <div className="panel h-full flex flex-col items-center justify-center p-6">
        <p className="text-gray-600 dark:text-gray-300">
          {t('profile_not_logged_in')}
        </p>
        <Button onClick={() => void handleLogin()} className="mt-4">
          {t('btn_login')}
        </Button>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col items-start justify-start p-6 space-y-4">
      <div className="text-gray-700 dark:text-gray-300">
        <p>
          {t('profile_email')}: <strong>{user?.email}</strong>
        </p>
      </div>
    </div>
  );
};

export default ProfilePage;
