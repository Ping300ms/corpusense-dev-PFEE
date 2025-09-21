import { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { Syncable } from '@/data/models/Syncable.ts';
import { db } from '@/data/repositories/indexeddb/db.ts';
import Dexie from 'dexie';
import { supabase } from '@/data/supabase/supabaseClient.ts';

export class SyncManager {
  private static instance: SyncManager | null = null;

  private readonly client: SupabaseClient;

  private constructor() {
    this.client = supabase;
  }

  public static getInstance(): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager();
    return SyncManager.instance;
  }

  public async create<T extends Syncable>(obj: T, type: keyof typeof db): Promise<SyncResult<T> | { error: string }> {
    const { user } = (await supabase.auth.getUser()).data;
    if (!user) {
      console.log(`[CREATE] Sync: error not logged in`);
      return { error: `[CREATE] Sync: error not logged in`};
    }

    obj.synced = true;

    const res = await this.client.from('backup').insert({
      user_id: user.id,
      object_id: obj.id,
      object_type: type,
      content: obj,
      updated_at: obj.updated_at,
    });

    if (res.error != null) {
      obj.synced = false;
      console.log({msg: res.statusText, error: res.error});
    } else await this.setSynced(obj, type, true)

    return {data: obj, error: res.error};
  }

  public async delete(id: string, type: keyof typeof db): Promise<{ error: string } | null> {
    return this.deleteByIds([id], type);
  }

  public async deleteByIds(ids: string[], type: keyof typeof db): Promise<{ error: string } | null> {
    const { user } = (await supabase.auth.getUser()).data;
    if (!user) {
      console.log(`[DELETE] Sync: error not logged in`);
      return { error: `[DELETE] Sync: error not logged in`};
    }

    const deletion_date = new Date().toISOString();
    const { error } = await this.client
      .from('backup')
      .update({ deleted_at: deletion_date, updated_at: deletion_date }) // soft delete
      .match({
        user_id: user.id,
        object_type: type,
      })
      .in('object_id', ids);

    return error == null ? error : { error: error.message };
  }

  public async sync<T extends Syncable>(obj: T, type: keyof typeof db): Promise<T | { error: string }> {
    const { user } = (await supabase.auth.getUser()).data;
    if (!user) {
      console.log(`[UPDATE] Sync: error not logged in`);
      return { error: `[UPDATE] Sync: error not logged in`};
    }

    const local: Backup<T> = {
      user_id: user.id,
      object_id: obj.id,
      object_type: type,
      content: obj,
      updated_at: obj.updated_at,
      deleted_at: null,
    };

    const ref = (
      await this.client
        .from('backup')
        .select('*')
        .eq('object_id', obj.id)
        .eq('object_type', type)
        .eq('user_id', user.id)
        .maybeSingle<Backup<T>>()
    ).data;

    let merged: Backup<T>;
    // TODO add real CRDT
    if (ref != null) {
      if (ref.updated_at < local.updated_at) { // local win
        merged = local;
        merged.updated_at = new Date().toISOString();
        merged.content.updated_at = merged.updated_at;
      } else { // remote win
        merged = ref; // TODO avoid updating remote with remote
      }
    } else { // no remote
      merged = local;
      merged.updated_at = new Date().toISOString();
      merged.content.updated_at = merged.updated_at;
    }

    merged.content.synced = true;

    const res = await this.client
      .from('backup')
      .upsert<Backup<T>>(merged, {
        onConflict: 'user_id,object_type,object_id',
      })
      .maybeSingle();

    if (res.error != null) {
      merged.content.synced = false;
      console.log({msg: res.statusText, error: res.error});
      return { error: res.error.message };
    }
    await this.setSynced(merged.content, type, true);

    return merged.content;
  }

  public async syncPendingFromTable<T extends Syncable>(type: keyof typeof db): Promise<void> {
    const { user } = (await supabase.auth.getUser()).data;
    if (!user) {
      console.log(`[UPDATE] Sync: error not logged in`);
      return;
    }

    const table = (db as any)[type] as Dexie.Table<T, T>;
    const unsynced = await table.filter((obj) => !obj.synced).toArray();
    for (const entity of unsynced) {
      await this.sync<T>(entity, type); // TODO optimize request numbers
    }
  }

  public async syncMultiples<T extends Syncable>(objs: T[], type: keyof typeof db): Promise<void> {
    const { user } = (await supabase.auth.getUser()).data;
    if (!user) {
      console.log(`[UPDATE] Sync: error not logged in`);
      return;
    }

    for (const entity of objs) {
      await this.sync<T>(entity, type);
    }
  }

  // TODO stock in local last pull date to filter already synced data
  public async pullFromRemote<T extends Syncable>(type: keyof typeof db): Promise<T[] | { error: string }> {
    const { user } = (await supabase.auth.getUser()).data;
    if (!user) {
      console.log(`[SELECT] Sync: error not logged in`);
      return { error: `[SELECT] Sync: error not logged in`};
    }

    const table = (db as any)[type] as Dexie.Table<T, string>;

    const { data: remotes, error } = await this.client
      .from('backup')
      .select('*')
      .eq('user_id', user.id)
      .eq('object_type', type);
      // TODO .gt('updated_at', ...)

    if (error) {
      console.error(`[Pull] Erreur récupération remote pour ${type}:`, error.message);
      return [];
    }
    if (!remotes || remotes.length === 0) return [];

    const locals = await table.toArray();
    const localMap = new Map<string, T>(
      locals.map((obj: T) => [obj.id, obj])
    );
    const res: T[] = new Array<T>();

    for (const remote of remotes as Backup<T>[]) {
      const local = localMap.get(remote.object_id);

      if (!local && remote.deleted_at != null) continue;

      let latest: T;
      if (!local) { // not in local
        console.log("salut");
        latest = {
          ...remote.content,
          synced: true,
          updated_at: remote.updated_at,
        }
      } else if (new Date(local.updated_at) < new Date(remote.updated_at)) { // local older than remote
        console.log("test");
        if (remote.deleted_at != null) { // remote has been deleted
          await table.delete(local.id);
          continue
        }

        latest = {
          ...remote.content,
          synced: true,
          updated_at: remote.updated_at,
        }
      } else continue;

      await table.put(latest);
      res.push(latest);
    }

    return res;
  }

  private async setSynced<T extends Syncable>(obj: T, type: keyof typeof db, state: boolean): Promise<void> {
    obj.synced = state;
    const res: number = await (db as any)[type].update(obj.id, obj);
    console.log({rowsUpdated: res, update: obj})
  }
}

export interface SyncResult<T extends Syncable> {
  data: T;
  error: PostgrestError | null;
}

interface Backup<T extends Syncable> {
  id?: string;
  user_id: string;
  object_id: string;
  object_type: string;
  content: T;
  updated_at: string;
  deleted_at: string | null;
}
