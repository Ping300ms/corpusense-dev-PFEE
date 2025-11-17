import { useState } from "react";
import { Share2 } from "lucide-react";
import ShareDialog from "./ShareDialog";
import { ListenerState } from '@/data/repositories/supabase/SupabaseRealtimeListener';
import { SyncManager } from '@/data/repositories/supabase/syncManager.ts';
import { toast } from 'sonner';

const ShareButton = ({ objectSharedId }: { objectSharedId: string }) => {
  const [open, setOpen] = useState(false);

  const canShare = () => {
    return SyncManager.getInstance().getState() === ListenerState.SUBSCRIBED;
  };

  const openShareDialog = () => {
    if (!canShare()) {
      toast.error("Not logged in");
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        className="soft-button mr-2"
        onClick={openShareDialog}
      >
        <Share2 size={24} />
      </button>

      {open && (
        <ShareDialog objectShared={objectSharedId} onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default ShareButton;
