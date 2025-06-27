import { useNavigate } from 'react-router-dom';
import { supabase } from '@/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

const ProfilePage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    await navigate('/'); // ou '/login' selon ta logique
  };

  return (
    <div className="panel h-full flex flex-col items-start justify-start p-6 space-y-4">
      <div className="text-gray-700 dark:text-gray-300">
        <p>
          {t('profile_email')}: <strong>{user?.email}</strong>
        </p>
      </div>

      <Button
        onClick={() => void handleLogout()}
        className="bg-red-500 hover:bg-red-600 text-white text-sm w-fit"
        title={t('btn_logout')}
        variant="ghost"
      >
        {t('btn_logout')}
      </Button>
    </div>
  );
};

export default ProfilePage;
