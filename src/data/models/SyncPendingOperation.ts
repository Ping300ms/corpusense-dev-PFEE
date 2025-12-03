import { SyncableObject, SyncableObjectName } from '@/data/models/Syncable.ts';

export interface SyncPendingOperation {
  id: string; //uuid
  type: "CREATE" | "UPDATE" | "DELETE";
  location: "DEXIE" | "SUPABASE";
  table: SyncableObjectName;
  object_id: string;
  old: SyncableObject | null;
  date: Date;
}