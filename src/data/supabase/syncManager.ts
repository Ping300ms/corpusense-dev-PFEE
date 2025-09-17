import { createClient, SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { Syncable } from '@/data/models/Syncable.ts';
import { db } from '@/data/repositories/indexeddb/db.ts';
import Dexie from 'dexie';

export class SyncManager {
  private static instance: SyncManager | null = null;

  private readonly client: SupabaseClient;
  private readonly userId = "29ec51b9-405e-410e-9188-99f40ca7ff46"; // TODO remplacer par auth.uid()

  private constructor() {
    this.client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    );
  }

  public static getInstance(): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager();
    return SyncManager.instance;
  }

  public async create<T extends Syncable>(obj: T, type: keyof typeof db): Promise<SyncResult<T>> {
    obj.synced = true;
    obj.updated_at = new Date().toISOString();

    return await this.sync<T>(obj, type);
  }

  public async delete(id: string, type: keyof typeof db): Promise<PostgrestError | null> {
    const { error } = await this.client
      .from('backup')
      .delete()
      .match({
        user_id: this.userId,
        object_type: type,
        object_id: id,
      });

    return error;
  }

  public async deleteByIds(ids: string[], type: keyof typeof db): Promise<PostgrestError | null> {
    const { error } = await this.client
      .from('backup')
      .delete()
      .match({
        user_id: this.userId,
        object_type: type,
      })
      .in('object_id', ids);

    return error;
  }

  public async sync<T extends Syncable>(obj: T, type: keyof typeof db): Promise<SyncResult<T>> {
    const local: Backup<T> = {
      id: null,
      user_id: this.userId,
      object_id: obj.id,
      object_type: type,
      content: obj,
      updated_at: obj.updated_at,
    };

    const ref = (
      await this.client
        .from('backup')
        .select('*')
        .eq('object_id', obj.id)
        .eq('object_type', type)
        .eq('user_id', this.userId)
        .single<Backup<T>>()
    ).data;

    let merged: Backup<T>;
    // TODO add CRDT
    if (ref != null) {
      merged = ref.updated_at < local.updated_at ? local : ref;
    } else {
      merged = local;
    }

    // FIXME set updated_at only on object changes
    merged.updated_at = new Date().toISOString();
    merged.content.synced = true;
    merged.content.updated_at = merged.updated_at;

    const res = await this.client
      .from('backup')
      .upsert<Backup<T>>(merged, {
        onConflict: 'user_id,object_type,object_id',
      })
      .single();

    if (!res.error) await (db as any)[type].put(merged.content);
    else merged.content.synced = false;

    return { data: merged.content, error: res.error };
  }

  public async syncPendingFromTable<T extends Syncable>(type: keyof typeof db): Promise<T[]> {
    const table = (db as any)[type] as Dexie.Table<T, any>;
    const unsynced = await table.where({ synced: false }).toArray();
    return this.syncMultiples<T>(unsynced, type)
  }

  public async syncMultiples<T extends Syncable>(objs: T[], type: keyof typeof db): Promise<T[]> {
    const res: T[] = new Array<T>();
    for (const entity of objs) {
      let { error } = await this.sync<T>(entity, type);
      if (error) return res;
      res.push(entity);
    }
    return res;
  }
}

export interface SyncResult<T extends Syncable> {
  data: T;
  error: PostgrestError | null;
}

interface Backup<T extends Syncable> {
  id: string | null;
  user_id: string;
  object_id: string;
  object_type: string;
  content: T;
  updated_at: string;
}
