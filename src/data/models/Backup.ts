import { SyncableObject, SyncableObjectNames } from '@/data/models/Syncable.ts';

export default interface Backup {
  id?: string;
  owner_id: string;
  object_id: string; // content.id
  object_type: SyncableObjectNames;
  content: SyncableObject;
  updated_at: string;
  change_id: string; // Sync operation id
  deleted_at: string | null;
  part_of: string | null;
}