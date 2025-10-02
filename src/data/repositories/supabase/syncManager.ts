import { SupabaseClient, User } from '@supabase/supabase-js';
import { db } from "@/data/repositories/indexeddb/db.ts";
import { EntityTable } from "dexie";
import { supabase } from "@/data/supabase/supabaseClient.ts";
import { Syncable } from "@/data/models/Syncable.ts";
import { syncableToUint8, uint8ToSyncable, mergeUint8, encodeDocToJSONB, decodeDocFromJSONB } from './yjsUtils.ts';

interface Backup {
  id?: string;
  user_id: string;
  object_id: string;
  object_type: string;
  content: number[];
  updated_at: string;
  deleted_at: string | null;
}

export class SyncManager {
  private static instance: SyncManager | null = null;

  private readonly client: SupabaseClient;
  private lastPull: Date;

  private constructor() {
    this.client = supabase;
    this.lastPull = new Date('2025-01-01T00:00:00Z');// TODO
  }

  public static getInstance(): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager();
    return SyncManager.instance;
  }

  public async create<T extends Syncable>(obj: T, type: keyof typeof db): Promise<T | { error: string }> {
    const user = await this.getUser();
    if (!user) return { error: `[CREATE] Sync: error not logged in`};

    const update = syncableToUint8(obj);

    const { error } = await this.client.from('backup').insert<Backup>({
      user_id: user.id,
      object_id: obj.id,
      object_type: type,
      content: encodeDocToJSONB(update),
      updated_at: obj.updated_at,
      deleted_at: null,
    });

    if (error) return { error: `[CREATE] Sync: error inserting into supabase ${type} ${obj.id} ${error.message}` };

    this.setSynced(obj, type, true);
    return obj;
  }

  public async delete(id: string, type: keyof typeof db): Promise<void | { error: string }> {
    return this.deleteByIds([id], type);
  }

  public async deleteByIds(ids: string[], type: keyof typeof db): Promise<void | { error: string }> {
    const user = await this.getUser();
    if (!user) return { error: `[DELETE] Sync: error not logged in`};

    const deletion_date = new Date().toISOString();
    const { error } = await this.client
      .from('backup')
      .update({ deleted_at: deletion_date, updated_at: deletion_date })
      .match({ user_id: user.id, object_type: type })
      .in('object_id', ids);

    if (error) return { error: `[DELETE] Sync: error deleting from supabase ${type} ${ids.toString()} ${error.message}` };
  }

  public async push<T extends Syncable>(obj: T, type: keyof typeof db): Promise<T | { error: string }> {
    const user = await this.getUser();
    if (!user) return { error: `[UPDATE] Sync: error not logged in`};

    const localUpdate = syncableToUint8(obj);

    const { data: remote, error } = await this.client
      .from('backup')
      .select('content, updated_at, deleted_at')
      .eq('user_id', user.id)
      .eq('object_id', obj.id)
      .eq('object_type', type)
      .maybeSingle<Backup>();

    if (error) return { error: `[PUSH] Sync: error pulling from supabase ${type} ${obj.id} ${error.message}` };

    let mergedUpdate = localUpdate;
    if (remote?.content != null) mergedUpdate = mergeUint8(localUpdate, decodeDocFromJSONB(remote.content));

    const mergedObj = uint8ToSyncable<T>(mergedUpdate);
    mergedObj.updated_at = new Date().toISOString();
    mergedObj.synced = true;

    const { error: upsertError } = await this.client.from('backup').upsert<Backup>(
      {
        user_id: user.id,
        object_id: obj.id,
        object_type: type,
        content: encodeDocToJSONB(mergedUpdate),
        updated_at: mergedObj.updated_at,
        deleted_at: remote?.deleted_at ?? null,
      },
      { onConflict: 'user_id,object_type,object_id' }
    );

    if (upsertError) return { error: `[PUSH] Sync: error updating into supabase ${type} ${obj.id} ${upsertError.message}` };

    this.setSynced(mergedObj, type, true);
    return mergedObj;
  }

  public async pushPending<T extends Syncable>(type: keyof typeof db): Promise<void> {
    const table = db[type] as unknown as EntityTable<T, 'id'>;
    const unsynced = await table.filter((obj) => !obj.synced).toArray();
    for (const entity of unsynced) {
      void this.push<T>(entity, type);
    }
  }

  public async pushMultiples<T extends Syncable>(objs: T[], type: keyof typeof db): Promise<void> {
    for (const obj of objs) {
      await this.push<T>(obj, type);
    }
  }

  public async pullUpdates<T extends Syncable>(type: keyof typeof db): Promise<T[] | { error: string }> {
    const user = await this.getUser();
    if (!user) return { error: `[SELECT] Sync: error not logged in` };

    const requestDate = new Date();

    const { data: remotes, error } = await this.client
      .from('backup')
      .select('object_id, content, updated_at, deleted_at')
      .eq('user_id', user.id)
      .eq('object_type', type)
      .gt('updated_at', this.lastPull.toISOString());

    if (error) return { error: `[PULL] Sync: error pulling from Supabase ${type} updates ${error.message}` };
    if (remotes == null || remotes.length === 0) return [];

    this.lastPull = requestDate;

    // TODO optimize read/write with dexie
    // TODO handle errors: make it transactional or don't update lastPull if error
    const table = db[type] as unknown as EntityTable<T, 'id'>;
    const locals = await table.toArray();
    const localMap = new Map<string, T>(locals.map(obj => [obj.id, obj]));

    const res: T[] = [];
    for (const remote of remotes as Backup[]) {
      if (remote.deleted_at != null) {
        // @ts-expect-error weird cast, but works
        void table.delete(remote.object_id);
        continue;
      }

      const local = localMap.get(remote.object_id);
      const mergedObj = uint8ToSyncable<T>(decodeDocFromJSONB(remote.content));

      if (!local || new Date(local.updated_at) < new Date(remote.updated_at)) {
        mergedObj.synced = true;
        void table.put(mergedObj);
        res.push(mergedObj);
      }
    }

    return res;
  }

  private setSynced<T extends Syncable>(obj: T, type: keyof typeof db, state: boolean): void{
    obj.synced = state;
    const table = db[type] as unknown as EntityTable<T, 'id'>;
    // @ts-expect-error weird cast, but it works
    void table.update(obj.id, obj);
  }

  private async getUser(): Promise<User | null> {
    return (await supabase.auth.getUser()).data.user;
  }
}
