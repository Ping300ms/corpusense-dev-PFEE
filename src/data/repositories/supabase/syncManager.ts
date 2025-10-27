import {
  PostgrestError,
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  Subscription,
  SupabaseClient,
} from '@supabase/supabase-js';
import { db, dbSync } from "@/data/repositories/indexeddb/db.ts";
import { DexieError, EntityTable } from 'dexie';
import { supabase } from '@/data/repositories/supabase/supabaseClient.ts';
import { Syncable, SyncableObject, SyncableTables } from '@/data/models/Syncable.ts';
import {
  syncableToUint8, uint8ToSyncable, mergeDocs, encodeDocToJSONB, decodeDocFromJSONB,
  uint8toDoc, syncableToDoc,
} from './yjsUtils.ts';
import Backup from '@/data/models/Backup.ts';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';
import { SupabaseRealtimeListener } from '@/data/repositories/supabase/SupabaseRealtimeListener.ts';
import { SupabaseListenerProperties } from '@/data/repositories/supabase/SupabaseListenerProperties.ts';

export class SyncManager {
  private static instance: SyncManager | null = null;

  private readonly client: SupabaseClient;
  private readonly dbToSync: typeof db;
  private readonly operationDb: typeof dbSync;
  private lastPull: Date;
  private userId: string | null = null;
  private isSyncing = false;

  private realtimeListener: SupabaseRealtimeListener<Backup> | null = null;
  private authStateListener: Subscription | null = null;

  private constructor(client: SupabaseClient = supabase,
                      dbToSync: typeof db = db,
                      operationDb: typeof dbSync = dbSync
  ) {
    this.client = client;
    this.dbToSync = dbToSync;
    this.operationDb = operationDb;
    this.lastPull = new Date(localStorage.getItem("LastPull") ?? '2025-01-01T00:00:00Z');

    this.initializeListeners();
  }

  public static getInstance(
    client: typeof supabase = supabase,
    dbToSync: typeof db = db,
    operationDb: typeof dbSync= dbSync
  ): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager(client, dbToSync, operationDb);
    return SyncManager.instance;
  }

  private initializeListeners() {
    // 1️⃣ — Dexie → Supabase
    new DexieObservableListener(
      this.dbToSync,
      {
      onAdd: (entity, table) => this.onLocalInsert(entity, table),
      onUpdate: (entity, table) => this.onLocalUpdate(entity, table),
      onDelete: (key, table) => this.onLocalDelete(key, table),
    });

    // 2️⃣ — Supabase → Dexie
    this.realtimeListener = new SupabaseRealtimeListener<Backup>(
      {
        tableName : "backup",
        channelBaseName : "backup", // TODO change channel naming to fit with collaboration logic
        onInsert : (p) => this.onRemoteInsert(p),
        onUpdate : (p) => this.onRemoteUpdate(p),
        onDelete : (p) => this.onRemoteDelete(p),
        onSubscribed : () => this.InitSync(),
        supabaseClient : this.client,
      } as SupabaseListenerProperties<Backup>);

    this.authStateListener = this.client.auth.onAuthStateChange((_event) => {
      switch (_event) {
        case 'SIGNED_IN':
          void this.realtimeListener?.subscribe();
          void this.getUser();
          break;
        case 'SIGNED_OUT':
          void this.realtimeListener?.removeExistingChannel();
          this.userId = null;
          break;
      }
    }).data.subscription;

    window.addEventListener('online', () => void this.realtimeListener?.subscribe());
    window.addEventListener('offline', () => void this.realtimeListener?.removeExistingChannel());
  }

  public async create<T extends Syncable>(obj: T, type: keyof typeof this.dbToSync): Promise<{ data: null, error: PostgrestError} | { data: T, error: null} | null> {
    await this.addPendingOperation("CREATE", "SUPABASE", type, obj.id);
    const userId = await this.getUser();
    if (!userId) return null;

    const update = syncableToUint8(obj);

    const { error } = await this.client.from('backup').insert<Backup>({
      user_id: userId,
      object_id: obj.id,
      object_type: type,
      content: encodeDocToJSONB(update),
      updated_at: obj.updated_at,
      deleted_at: null,
    });

    if (error) return { data: null, error};
    return {data: obj, error: null};
  }

  public async delete(id: string, type: keyof typeof this.dbToSync): Promise<{ data: null, error: PostgrestError} | { data: string, error: null} | null> {
    await this.addPendingOperation("DELETE", "SUPABASE", type, id);

    const userId = await this.getUser();
    if (!userId) return null;

    const deletion_date = new Date().toISOString();
    const { error } = await this.client
      .from('backup')
      .update({ deleted_at: deletion_date, updated_at: deletion_date })
      .eq('user_id', userId)
      .eq('object_id', id)
      .eq('object_type', type)
      .select()
      .maybeSingle<Backup>();

    if (error) return { data: null, error};
    return {data: id, error: null};
  }

  public async push<T extends Syncable>(obj: T, type: keyof typeof this.dbToSync): Promise<{ data: null, error: PostgrestError} | { data: T, error: null} | null> {
    await this.addPendingOperation("UPDATE", "SUPABASE", type, obj.id);

    const userId = await this.getUser();
    if (!userId) return null;

    const localUpdate = syncableToUint8(obj);

    const { data: remote, error : selectError } = await this.client
      .from('backup')
      .select('content, updated_at, deleted_at')
      .eq('user_id', userId)
      .eq('object_id', obj.id)
      .eq('object_type', type)
      .select()
      .maybeSingle<Backup>();

    if (selectError) return { data: null, error: selectError };

    let mergedUpdate = localUpdate;
    if (remote?.content != null) mergedUpdate = mergeDocs(uint8toDoc(localUpdate), uint8toDoc(decodeDocFromJSONB(remote.content))).local;

    const mergedObj = uint8ToSyncable<T>(mergedUpdate);
    mergedObj.updated_at = new Date().toISOString();

    const { error: upsertError } = await this.client.from('backup').upsert<Backup>(
      {
        user_id: userId,
        object_id: obj.id,
        object_type: type,
        content: encodeDocToJSONB(mergedUpdate),
        updated_at: mergedObj.updated_at,
        deleted_at: remote?.deleted_at ?? null,
      },
      { onConflict: 'user_id,object_type,object_id' }
    );

    if (upsertError) return { data: null, error: upsertError};
    return {data: mergedObj, error: null};
  }

  public async pushPendingOperations(): Promise<void> {
    const pending = await this.operationDb.pendingOperations.orderBy('date')
      .filter((op) => op.location === "SUPABASE"
    ).toArray();
    // FIXME : error handler 406 et 409

    for (const op of pending) {
      console.log(`[SyncManager] Replaying pending ${op.type} → ${op.table}:${op.object_id}`);

      switch (op.type) {
        case "CREATE": {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (obj) await this.create(obj, op.table as keyof typeof this.dbToSync);
          break;
        }
        case "UPDATE": {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (obj) await this.push(obj, op.table as keyof typeof this.dbToSync);
          break;
        }
        case "DELETE": {
          await this.delete(op.object_id, op.table as keyof typeof this.dbToSync);
          break;
        }
      }
    }
  }

  private async isPendingOperation(
    type: "CREATE" | "UPDATE" | "DELETE",
    location: "DEXIE" | "SUPABASE",
    table: string,
    object_id: string
  ) {
    const operation = await dbSync.pendingOperations.filter(
      (op) =>
        object_id === op.object_id &&
        op.type === type &&
        op.location === location &&
        op.table === table &&
        op.object_id === object_id
    ).first();
    return operation?.id ?? null;
  }

  private async addPendingOperation(
    type: "CREATE" | "UPDATE" | "DELETE",
    location: "DEXIE" | "SUPABASE",
    table: string,
    object_id: string
  ): Promise<string> {
    const obj = await dbSync.pendingOperations.filter(
      (op) => object_id === op.object_id
    ).first();

    if (obj === undefined) {
      return dbSync.pendingOperations.add({
        id: crypto.randomUUID(),
        type,
        location,
        table,
        object_id,
        date: new Date(),
      });
    }

    if (obj.type !== type) await dbSync.pendingOperations.update(obj.id, { ...obj, type });

    return obj.id;
  }

  private async removePendingOperation(id: string): Promise<void> {
    await dbSync.pendingOperations.delete(id);
  }

  public async pullUpdates<T extends Syncable>(type: keyof typeof this.dbToSync): Promise<{ error: string } | null> {
    const user = await this.getUser();
    if (!user) return { error: `[SELECT] Sync: error not logged in` };

    const requestDate = new Date();

    const { data: remotes, error } = await this.client
      .from('backup')
      .select('object_id, content, updated_at, deleted_at')
      .eq('user_id', user)
      .eq('object_type', type)
      .gt('updated_at', this.lastPull.toISOString())
      .order('updated_at'); // from oldest to newest

    if (error) return { error: `[PULL] Sync: error pulling from Supabase ${type} updates ${error.message}` };
    if (remotes == null || remotes.length === 0) return null;

    const objectIds : string[] = remotes.map((backup) => backup.object_id);

    const table = this.dbToSync[type] as unknown as EntityTable<SyncableObject, 'id'>;
    const locals = await table.bulkGet(objectIds);

    const toCreate: T[] = [];
    const toUpdate: T[] = [];
    const toDelete: string[] = [];

    for (let i = 0; i < locals.length; i++) {
      if (remotes[i].deleted_at != null) {
        if (!locals[i]) continue;
        toDelete.push(remotes[i].object_id);
        continue;
      }

      const local = locals[i];
      if (!local) {
        toCreate.push(uint8ToSyncable<T>(decodeDocFromJSONB(remotes[i].content)));
        continue;
      }

      if (new Date(local.updated_at) < new Date(local.updated_at)) {
        const remoteDoc = uint8toDoc(decodeDocFromJSONB(remotes[i].content));
        const mergedObject = uint8ToSyncable<T>(mergeDocs(remoteDoc, syncableToDoc(local)).remote);
        toUpdate.push(mergedObject);
      }
      // if local is newer than remote keep local changes
    }

    await table.bulkDelete(toDelete);
    await table.bulkAdd(toCreate);
    await table.bulkPut(toUpdate);

    localStorage.setItem("LastPull", requestDate.toString());
    this.lastPull = requestDate;
    return null;
  }

  private async onLocalInsert(entity : SyncableObject, table : string) {
    const pendingId = await this.isPendingOperation("CREATE", "DEXIE", table, entity.id)
    if (pendingId !== null) {
      await this.removePendingOperation(pendingId);
      return;
    }
    console.log(`[Dexie] Added ${table} → pushing to Supabase`);
    const result = await this.create(entity, table as keyof typeof this.dbToSync);
    if (result?.error) this.remoteRequestErrorHandler(entity.id, "CREATE", result?.error);
  }

  private async onLocalUpdate(entity : SyncableObject, table : string) {
    const pendingId = await this.isPendingOperation("UPDATE", "DEXIE", table, entity.id)
    if (pendingId !== null) {
      await this.removePendingOperation(pendingId);
      return;
    }
    console.log(`[Dexie] Updated ${table} → pushing to Supabase`, entity);
    const result = await this.push(entity, table as keyof typeof this.dbToSync);
    if (result?.error) this.remoteRequestErrorHandler(entity.id, "UPDATE", result?.error);
  }

  private async onLocalDelete(key : string, table : string) {
    const pendingId = await this.isPendingOperation("DELETE", "DEXIE", table, key)
    if (pendingId !== null) {
      await this.removePendingOperation(pendingId);
      return;
    }
    console.log(`[Dexie] Deleted ${table} → deleting in Supabase`);
    const result = await this.delete(key, table as keyof typeof this.dbToSync);
    if (result?.error) this.remoteRequestErrorHandler(key, "DELETE", result?.error);
  }

  private async onRemoteInsert(payload: RealtimePostgresInsertPayload<Backup>) : Promise<void> {
    const pendingId = await this.isPendingOperation(
      "CREATE",
      "SUPABASE",
      payload.new.object_type,
      payload.new.object_id
    )
    if (pendingId !== null) {
      await this.removePendingOperation(pendingId);
      return;
    }
    console.log(`[Supabase] Add ${payload.new.object_type} → adding to dexie`);
    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler(payload.new.object_id, "CREATE", error);
  }

  private async onRemoteUpdate(payload: RealtimePostgresUpdatePayload<Backup>) : Promise<void> {
    const pendingId = await this.isPendingOperation(
      payload.new.deleted_at !== null ? "DELETE" : "UPDATE",
      "SUPABASE",
      payload.new.object_type,
      payload.new.object_id
    )
    if (pendingId !== null) {
      await this.removePendingOperation(pendingId);
      return;
    }
    console.log(`[Supabase] Updated ${payload.new.object_type} → update in dexie`, uint8ToSyncable(decodeDocFromJSONB(payload.new.content)));
    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler(payload.new.object_id, "UPDATE", error);
  }

  private async onRemoteDelete(payload: RealtimePostgresDeletePayload<Backup>) : Promise<void> {
    if (payload.old == null) return;
    console.log(`[Supabase] Delete ${payload.old.object_type} → delete in dexie`);
    const { error } = await this.applyRemoteDelete(payload.old);
    if (error && payload.old.object_id) this.localRequestErrorHandler(payload.old.object_id, "DELETE", error);
  }

  private async applyRemoteChange(backup: Backup): Promise<{error: DexieError | null}> {
    if (backup.deleted_at != null) { // remote has been soft deleted
      await this.addPendingOperation("DELETE", "DEXIE", backup.object_type, backup.object_id);
      return await this.applyRemoteDelete(backup);
    }

    const { object_id, object_type, content } = backup;
    const remote = decodeDocFromJSONB(content);
    const table = this.dbToSync[object_type as keyof typeof this.dbToSync] as unknown as EntityTable<SyncableObject, 'id'>;
    const local = await table.get(object_id);

    if (local === undefined) { // local doesn't exist
      await this.addPendingOperation("CREATE", "DEXIE", backup.object_type, backup.object_id);
      try {
        await table.add(uint8ToSyncable(remote));
      } catch (err : unknown) {
        if (this.isDexieError(err)) {
          this.localRequestErrorHandler(object_id, "CREATE", err);
          return { error: err };
        }
        throw err;
      }
      return { error: null };
    }

    const merged = uint8ToSyncable(mergeDocs(uint8toDoc(syncableToUint8(local)), uint8toDoc(remote)).remote);

    console.log(`[Supabase] Applying remote ${object_type} ${object_id}`, merged);
    await this.addPendingOperation("UPDATE", "DEXIE", backup.object_type, backup.object_id);
    try {
      await table.put(merged);
    } catch (err : unknown) {
      if (this.isDexieError(err)) {
        this.localRequestErrorHandler(object_id, "UPDATE", err);
        return { error: err };
      }
      throw err;
    }
    return { error: null };
  }

  // remote has been hard deleted
  private async applyRemoteDelete(backup: Partial<Backup>): Promise<{error: DexieError | null}> {
    const { object_id, object_type } = backup;
    if (object_id === undefined) return { error: null };

    const table = this.dbToSync[object_type as keyof typeof this.dbToSync] as unknown as EntityTable<SyncableObject, 'id'>;

    console.log(`[Supabase] Deleting remote ${object_type} ${object_id}`);
    try {
      await table.delete(object_id);
    } catch (err : unknown) {
      if (this.isDexieError(err)) {
        this.localRequestErrorHandler(object_id, "DELETE", err);
        return { error: err };
      }
      throw err;
    }
    return { error: null };
  }

  public async InitSync() {
    if (this.isSyncing) return; // prevent parallel syncing
    this.isSyncing = true;
    for (const table of SyncableTables) {
      await this.pullUpdates(table as keyof typeof this.dbToSync);
      // FIXME cas delete from remote et pending operation push update sur une entité delete
    }
    await this.pushPendingOperations();
    this.isSyncing = false;
  }

  private async getUser(): Promise<string | null> {
    if (this.userId == null)
      this.userId = (await this.client.auth.getUser()).data.user?.id ?? null;
    return this.userId;
  }

  private remoteRequestErrorHandler(key : string, operation: "CREATE" | "UPDATE" | "DELETE", error : PostgrestError) : void {
    console.log(`[Supabase] Remote ${operation} on ${key} failed: ${error.message}`, error);
  }

  private localRequestErrorHandler(key : string, operation: "CREATE" | "UPDATE" | "DELETE", error : DexieError) : void {
    console.log(`[Dexie] Local ${operation} on ${key} failed: ${error.message}`, error);
  }

  public async destroy(): Promise<void> {
    await this.realtimeListener?.removeExistingChannel();
    this.authStateListener?.unsubscribe();
    window.removeEventListener('online', () => void this.realtimeListener?.subscribe());
    window.removeEventListener('offline', () => void this.realtimeListener?.removeExistingChannel());
  }

  private isDexieError(err: any): err is DexieError {
    return err && typeof err === 'object' && typeof err.name === 'string' && err.name.startsWith('Dexie');
  }
}
