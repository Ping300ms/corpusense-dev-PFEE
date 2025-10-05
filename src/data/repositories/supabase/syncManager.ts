import { SupabaseClient, User } from '@supabase/supabase-js';
import { db } from "@/data/repositories/indexeddb/db.ts";
import { EntityTable } from "dexie";
import { supabase } from '@/data/repositories/supabase/supabaseClient.ts';
import { Syncable, SyncableObject, SyncableTables } from '@/data/models/Syncable.ts';
import { syncableToUint8, uint8ToSyncable, mergeUint8, encodeDocToJSONB, decodeDocFromJSONB } from './yjsUtils.ts';
import Backup from '@/data/models/Backup.ts';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';
import { SupabaseRealtimeListener } from '@/data/repositories/supabase/SupabaseRealtimeListener.ts';

export class SyncManager {
  private static instance: SyncManager | null = null;

  private readonly client: SupabaseClient;
  private lastPull: Date;

  private dexieListener: DexieObservableListener | null = null;
  private realtimeListener: SupabaseRealtimeListener<Backup> | null = null;

  private constructor() {
    this.client = supabase;
    this.lastPull = new Date(localStorage.getItem("LastPull") ?? '2025-01-01T00:00:00Z');

    void this.initializeListeners();
    // if (navigator.onLine) this.handleOnline();
  }

  public static getInstance(): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager();
    return SyncManager.instance;
  }

  private async initializeListeners() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    const user = await this.getUser();
    if (!user) return;

    // 1️⃣ — Dexie → Supabase
    this.dexieListener = new DexieObservableListener({
      onAdd: async (entity, table) => {
        console.log(`[Dexie] Added ${table} → pushing to Supabase`);
        await this.create(entity, table as keyof typeof db);
      },
      onUpdate: async (entity, table) => {
        console.log(`[Dexie] Updated ${table} → pushing to Supabase`);
        await this.push(entity, table as keyof typeof db);
      },
      onDelete: async (entity, table) => {
        console.log(`[Dexie] Deleted ${table} → deleting in Supabase`);
        await this.delete(entity.id, table as keyof typeof db);
      },
    });

    // 2️⃣ — Supabase → Dexie
    this.realtimeListener = new SupabaseRealtimeListener<Backup>(
      this.client,
      {
        onAdd: async (backup) => await this.applyRemoteChange(backup),
        onUpdate: async (backup) => await this.applyRemoteChange(backup),
        onDelete: async (backup) => await this.applyRemoteDelete(backup),
      },
      user.id
    );
  }

  public async create<T extends Syncable>(obj: T, type: keyof typeof db): Promise<T | { error: string }> {
    const pendingId = await this.addPendingOperation("CREATE", type, obj.id);

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

    await this.removePendingOperation(pendingId);
    return obj;
  }

  public async delete(id: string, type: keyof typeof db): Promise<void | { error: string }> {
    const pendingId = await this.addPendingOperation("DELETE", type, id);

    const user = await this.getUser();
    if (!user) return { error: `[DELETE] Sync: error not logged in`};

    const deletion_date = new Date().toISOString();
    const { error } = await this.client
      .from('backup')
      .update({ deleted_at: deletion_date, updated_at: deletion_date })
      .eq('user_id', user.id)
      .eq('object_id', id)
      .eq('object_type', type)
      .maybeSingle<Backup>();

    if (error) return { error: `[DELETE] Sync: error deleting from supabase ${type} ${id} ${error.message}` };

    await this.removePendingOperation(pendingId);
  }

  public async push<T extends Syncable>(obj: T, type: keyof typeof db): Promise<T | { error: string }> {
    const pendingId = await this.addPendingOperation("UPDATE", type, obj.id);

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

    await this.removePendingOperation(pendingId);
    return mergedObj;
  }

  public async pushPendingOperations(): Promise<void> {
    const pending = await db.syncPendingOperations.orderBy('date').toArray();

    for (const op of pending) {
      console.log(`[SyncManager] Replaying pending ${op.type} → ${op.table}:${op.object_id}`);

      switch (op.type) {
        case "CREATE": {
          const table = db[op.table as keyof typeof db] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (obj) await this.create(obj, op.table as keyof typeof db);
          break;
        }
        case "UPDATE": {
          const table = db[op.table as keyof typeof db] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (obj) await this.push(obj, op.table as keyof typeof db);
          break;
        }
        case "DELETE": {
          await this.delete(op.object_id, op.table as keyof typeof db);
          break;
        }
      }
    }
  }

  private async addPendingOperation(
    type: "CREATE" | "UPDATE" | "DELETE",
    table: string,
    object_id: string
  ): Promise<string> {
    const obj = await db.syncPendingOperations.filter(
      (op) => object_id === op.object_id
    ).first();

    if (obj === undefined) {
      return db.syncPendingOperations.add({
        id: crypto.randomUUID(),
        type,
        table,
        object_id,
        date: new Date(),
      });
    }

    if (obj.type !== type) await db.syncPendingOperations.update(obj.id, { ...obj, type });

    return obj.id;
  }

  private async removePendingOperation(id: string): Promise<void> {
    await db.syncPendingOperations.delete(id);
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

    // TODO optimize read/write with bulk on dexie
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
        void table.put(mergedObj);
        res.push(mergedObj);
      }
    }

    this.lastPull = requestDate;
    localStorage.setItem("lastPull", requestDate.toString());
    return res;
  }

  private async applyRemoteChange(backup: Backup): Promise<void> {
    if (backup.deleted_at != null) { // remote has been soft deleted
      await this.applyRemoteDelete(backup);
      return;
    }

    const { object_id, object_type, content } = backup;
    const remote = decodeDocFromJSONB(content);
    const table = db[object_type as keyof typeof db] as unknown as EntityTable<SyncableObject, 'id'>;
    const local = await table.get(object_id);

    if (local === undefined) { // local doesn't exist
      await table.add(uint8ToSyncable(remote));
      return;
    }

    const merged = uint8ToSyncable(mergeUint8(syncableToUint8(local), remote));

    console.log(`[Supabase] Applying remote ${object_type} ${object_id}`);
    await table.put(merged);
  }

  // remote has been hard deleted
  private async applyRemoteDelete(backup: Partial<Backup>): Promise<void> {
    const { object_id, object_type } = backup;
    if (object_id === undefined) return;

    const table = db[object_type as keyof typeof db] as unknown as EntityTable<SyncableObject, 'id'>;

    console.log(`[Supabase] Deleting remote ${object_type} ${object_id}`);
    await table.delete(object_id);
  }

  private handleOnline() {
    this.realtimeListener?.connect();
    SyncableTables.forEach((value) => void this.pullUpdates(value as keyof typeof db));
    void this.pushPendingOperations();
  }

  private handleOffline() {
    void this.realtimeListener?.disconnect();
  }

  private async getUser(): Promise<User | null> {
    return (await supabase.auth.getUser()).data.user;
  }

  public async destroy(): Promise<void> {
    if (this.dexieListener) this.dexieListener = null;
    if (this.realtimeListener) {
      await this.realtimeListener.destroy();
      this.realtimeListener = null;
    }
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }
}
