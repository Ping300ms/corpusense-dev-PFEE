/* eslint-disable @typescript-eslint/no-misused-promises */
import { useState } from "react";
import "./shareDialog.css";
import { toast } from 'sonner';
import { SyncManager } from '@/data/repositories/supabase/syncManager.ts';

interface Props {
  onClose: () => void;
  objectShared: string;
}

export default function ShareDialog({ onClose, objectShared }: Props) {
  const [email, setEmail] = useState("");

  const handleSubmit = async () => {
    if (!email) {
      toast.error("L'email est requis");
      return;
    }

    toast.info("Partage en cours");
    const manager = SyncManager.getInstance();
    const res = await manager.share(objectShared, email, "collections", "RWD");
    if (res?.error != undefined) {
      toast.error(res?.error);
      console.error(res?.error);
    }
    else toast.success(`Collection partagée avec succes à ${email}`)
  };

  return (
    <div className="share-overlay">
      <div className="share-modal">
        <h2>Partager le document</h2>

        <input
          type="email"
          placeholder="Adresse email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="share-input"
        />

        <div className="share-actions">
          <button className="btn-cancel" onClick={onClose}>Fermer</button>
          <button className="btn-confirm" onClick={handleSubmit}>Partager</button>
        </div>
      </div>
    </div>
  );
}
