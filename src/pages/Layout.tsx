import HistoryDrawer from '@/components/drawers/HistoryDrawer';
import { Toaster } from '@/components/ui/sonner';
import { useAppDispatch, useAppSelector } from '@/hooks/hooks';
import useDialog from '@/hooks/ui/useDialog';
import { resetLastEvent } from '@/state/reducers/events';
import { selectLastErrorEvent, selectLastInfoEvent } from '@/state/selectors/events';
import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { toast } from 'sonner';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar';
import LayoutSideBar from './LayoutSidebar';
import { supabase } from '@/data/repositories/supabase/supabaseClient.ts';
import { User } from '@supabase/supabase-js';
import useAppNavigation from '@/hooks/useAppNavigation.tsx';

const Layout = () => {
  const { t } = useTranslation();
  const appDispatch = useAppDispatch();
  const { openOpenManifestDialog, openContactUsDialog } = useDialog();
  const lastInfo = useAppSelector(selectLastInfoEvent);
  const lastError = useAppSelector(selectLastErrorEvent);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const navigate = useAppNavigation()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    if (lastInfo !== undefined) {
      toast.success(lastInfo.message);
      appDispatch(resetLastEvent());
    }
  }, [lastInfo]);

  useEffect(() => {
    if (lastError !== undefined) {
      toast.error(lastError.message);
      appDispatch(resetLastEvent());
    }
  }, [lastError]);

  useEffect(() => {
    if (selectedWorkerId !== '') {
      setIsOpen(true);
    }
  }, [selectedWorkerId]);

  // Reset selected worker when drawer closes (if not, the drawer will not reopen)
  useEffect(() => {
    if (!isOpen) {
      setSelectedWorkerId('');
    }
  }, [isOpen]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUser(data?.user))

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    await navigate.goToHome()
  }

  return (
    <SidebarProvider>
      <LayoutSideBar setSelectedWorkerId={setSelectedWorkerId} />
      <SidebarInset className='flex h-screen min-w-0 flex-col'>
        <div className='flex h-full w-full flex-col p-2'>
          <header className='flex shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12'>
            <div className='flex items-center space-x-2'>
              <SidebarTrigger />
              <button
                className='soft-button'
                aria-label={t('btn_open_manifest')}
                onClick={openOpenManifestDialog}
              >
                <FolderOpen size={16} />
                {t('btn_open_manifest')}
              </button>
              <HistoryDrawer />
              <button
                className='soft-button'
                aria-label={t('btn_open_contact')}
                onClick={openContactUsDialog}
              >
                <FolderOpen size={16} />
                {t('btn_open_contact')}
              </button>
            </div>

            <div className='ml-auto'>
              {!user ? (
                <button
                  className='soft-button'
                  onClick={() => void navigate.goToLogin()}
                >
                  {t('btn_login')}
                </button>
              ) : (
                <button
                  className='soft-button'
                  onClick={() => void handleLogout()}
                >
                  {t('btn_logout')}
                </button>
              )}
            </div>
          </header>
          <main className='flex-1 pt-2'>
            <Outlet />
          </main>
        </div>
        <Toaster position='top-right' expand={true} richColors />
      </SidebarInset>
    </SidebarProvider>
  );
};

export default Layout;
