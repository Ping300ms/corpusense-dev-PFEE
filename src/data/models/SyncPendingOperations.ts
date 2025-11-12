import { SyncableObject } from '@/data/models/Syncable.ts';

export interface SyncPendingOperations {
  id: string; //uuid
  type: "CREATE" | "UPDATE" | "DELETE";
  location: "DEXIE" | "SUPABASE";
  table: string; // keyof typeof db
  object_id: string;
  old: SyncableObject | null;
  date: Date;
}