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
import { SyncableObject, SyncableTables } from '@/data/models/Syncable.ts';
import {
  syncableToUint8, uint8ToSyncable, mergeDocs, encodeDocToJSONB, decodeUintFromJSONB,
  uint8toDoc, syncableToDoc,
} from './yjsUtils.ts';
import Backup from '@/data/models/Backup.ts';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';
import { SupabaseRealtimeListener } from '@/data/repositories/supabase/SupabaseRealtimeListener.ts';
import { SupabaseListenerProperties } from '@/data/repositories/supabase/SupabaseListenerProperties.ts';
import { SyncPendingOperations } from '@/data/models/SyncPendingOperations.ts';
import { v4 as uuid } from 'uuid';

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
    operationDb: typeof dbSync = dbSync
  ): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager(client, dbToSync, operationDb);
    return SyncManager.instance;
  }

  private initializeListeners() {
    // Dexie → Supabase
    new DexieObservableListener(
      this.dbToSync,
      {
      onAdd: (entity, table) => this.onLocalInsert(entity, table),
      onUpdate: (entity, table) => this.onLocalUpdate(entity, table),
      onDelete: (key, table) => this.onLocalDelete(key, table),
    });

    // Supabase → Dexie
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

  public async create(obj: SyncableObject, type: keyof typeof this.dbToSync): Promise<{ data: null, error: PostgrestError} | { data: SyncableObject, error: null} | null> {
    const operation = await this.addPendingOperation("CREATE", "SUPABASE", type, obj.id);
    const userId = await this.getUser();
    if (!userId) return null;

    const update = syncableToUint8(obj);

    const { error } = await this.client.from('backup').insert<Backup>({
      user_id: userId,
      object_id: obj.id,
      object_type: type,
      content: encodeDocToJSONB(update),
      updated_at: operation.date.toISOString(),
      updated_by: this.userId,
      deleted_at: null,
    } as Backup);

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
      .update({ deleted_at: deletion_date, updated_at: deletion_date, updated_by: this.userId })
      .eq('user_id', userId)
      .eq('object_id', id)
      .eq('object_type', type)
      .select()
      .maybeSingle<Backup>();

    if (error)
      return { data: null, error};
    return {data: id, error: null};
  }

  public async push(obj: SyncableObject, type: keyof typeof this.dbToSync): Promise<{ data: null, error: PostgrestError} | { data: SyncableObject, error: null} | null> {
    const operation = await this.addPendingOperation("UPDATE", "SUPABASE", type, obj.id);

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
    if (remote?.content != null)
      mergedUpdate = mergeDocs(
        { doc: uint8toDoc(localUpdate), date: new Date() },
        { doc: uint8toDoc(decodeUintFromJSONB(remote.content)), date: new Date(remote.updated_at) }
      ).local;

    const mergedObj = uint8ToSyncable(mergedUpdate);

    const { error: upsertError } = await this.client.from('backup').upsert<Backup>(
      {
        user_id: this.userId,
        object_id: obj.id,
        object_type: type,
        content: encodeDocToJSONB(mergedUpdate),
        updated_at: operation.date.toISOString(),
        updated_by: this.userId,
        deleted_at: remote?.deleted_at ?? null,
      } as Backup,
      { onConflict: 'user_id,object_type,object_id' }
    );

    if (upsertError) return { data: null, error: upsertError};
    return {data: mergedObj, error: null};
  }

  public async pushPendingOperations(): Promise<void> {
    const pending = await this.operationDb.pendingOperations.orderBy('date')
      .filter((op) => op.location === "SUPABASE"
    ).toArray();

    for (const op of pending) {
      console.log(`[SyncManager] Replaying pending ${op.type} → ${op.table}:${op.object_id}`);

      switch (op.type) {
        case "CREATE": {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (!obj) {
            await this.operationDb.pendingOperations.delete(op.id);
            break;
          }
          const res = await this.create(obj, op.table as keyof typeof this.dbToSync);
          if (res?.error) this.remoteRequestErrorHandler(op.object_id, op.type, res.error);
          break;
        }
        case "UPDATE": {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (!obj) {
            await this.operationDb.pendingOperations.delete(op.id);
            break;
          }
          const res = await this.push(obj, op.table as keyof typeof this.dbToSync);
          if (res?.error) this.remoteRequestErrorHandler(op.object_id, op.type, res.error);
          break;
        }
        case "DELETE": {
          const obj = await this.client.from('backup').select('deleted_at').eq('object_id', op.object_id).eq('object_type', op.table).maybeSingle();
          if (obj.data == null || obj.data.deleted_at != null) {
            await this.operationDb.pendingOperations.delete(op.id);
            break;
          }
          const res = await this.delete(op.object_id, op.table as keyof typeof this.dbToSync);
          if (res?.error) this.remoteRequestErrorHandler(op.object_id, op.type, res.error);
          break;
        }
      }
    }
  }

  private async getPendingOperation(
    type: "CREATE" | "UPDATE" | "DELETE",
    target: "DEXIE" | "SUPABASE",
    table: string,
    object_id: string
  ) : Promise<SyncPendingOperations | undefined> {
    return this.operationDb.pendingOperations.filter(
      (op) =>
        object_id === op.object_id &&
        op.type === type &&
        op.location === target &&
        op.table === table
    ).first();
  }

  private async removePendingOperation(
    type: "CREATE" | "UPDATE" | "DELETE",
    target: "DEXIE" | "SUPABASE",
    table: string,
    object_id: string
  ) {
    const operation = await this.getPendingOperation(type, target, table, object_id);
    if (operation !== undefined) await this.operationDb.pendingOperations.delete(operation.id);
    return operation?.id ?? null;
  }

  private async addPendingOperation(
    type: "CREATE" | "UPDATE" | "DELETE",
    location: "DEXIE" | "SUPABASE",
    table: string,
    object_id: string
  ): Promise<SyncPendingOperations> {
    const operation = await this.getPendingOperation(type, location, table, object_id);

    if (operation === undefined) {
      const res = {
        id: uuid(),
        type,
        location,
        table,
        object_id,
        date: new Date(),
      } as SyncPendingOperations;
      await this.operationDb.pendingOperations.add(res);
      return res;
    }

    const res = {...operation, date: new Date()} as SyncPendingOperations;
    await this.operationDb.pendingOperations.update(operation.id, res);

    return res;
  }

  public async pullUpdates(tableName: keyof typeof this.dbToSync): Promise<{ error: string } | null> {
    const user = await this.getUser();
    if (!user) return { error: `[SELECT] Sync: error not logged in` };

    const requestDate = new Date();

    const { data: remotes, error } = await this.client
      .from('backup')
      .select('object_id, content, updated_at, deleted_at')
      .eq('user_id', user)
      .eq('object_type', tableName)
      .gt('updated_at', this.lastPull.toISOString())
      .order('updated_at', { ascending: true});

    if (error) return { error: `[PULL] Sync: error pulling from Supabase ${tableName} updates ${error.message}` };
    if (remotes == null || remotes.length === 0) return null;

    const objectIds : string[] = remotes.map((backup) => backup.object_id);

    const table = this.dbToSync[tableName] as unknown as EntityTable<SyncableObject, 'id'>;
    const locals = await table.bulkGet(objectIds);

    const toCreate: SyncableObject[] = [];
    const toUpdate: SyncableObject[] = [];
    const toDelete: string[] = [];
    const syncOperations: SyncPendingOperations[] = [];

    for (let i = 0; i < locals.length; i++) {
      const remote = remotes[i];
      const local = locals[i];

      if (remote.deleted_at != null) {
        // Edge case : remote delete while offline update, delete wins
        if (!local) continue;
        syncOperations.push({id: uuid(), type: "DELETE", location: "DEXIE", object_id: remote.object_id, table: tableName, date: new Date()});
        toDelete.push(remote.object_id);
        continue;
      }

      if (!local) {
        syncOperations.push({id: uuid(), type: "CREATE", location: "DEXIE", object_id: remote.object_id, table: tableName, date: new Date()});
        toCreate.push(uint8ToSyncable(decodeUintFromJSONB(remote.content)));
        continue;
      }

      // Check if conflict
      const operation = await this.getPendingOperation("UPDATE", "SUPABASE", tableName, local.id);
      let finalObject: SyncableObject;
      if (operation) { // conflict
        const remoteDoc = uint8toDoc(decodeUintFromJSONB(remote.content))
        finalObject = uint8ToSyncable(mergeDocs({ doc: syncableToDoc(local), date: operation.date }, { doc: remoteDoc, date: remote.updated_at }).remote);
      } else {
        finalObject = uint8ToSyncable(decodeUintFromJSONB(remote.content))
      }

      syncOperations.push({id: uuid(), type: "UPDATE", location: "DEXIE", object_id: remote.object_id, table: tableName, date: new Date()});
      toUpdate.push(finalObject);
    }

    await this.operationDb.pendingOperations.bulkAdd(syncOperations);
    await table.bulkDelete(toDelete);
    await table.bulkAdd(toCreate);
    await table.bulkPut(toUpdate);

    localStorage.setItem("LastPull", requestDate.toString());
    this.lastPull = requestDate;
    return null;
  }

  private async onLocalInsert(entity : SyncableObject, table : string) {
    const operation = await this.getPendingOperation("CREATE", "DEXIE", table, entity.id)
    if (operation !== undefined) {
      await this.operationDb.pendingOperations.delete(operation.id);
      return;
    }
    console.log(`[Dexie] Added ${table} → pushing to Supabase`);
    const result = await this.create(entity, table as keyof typeof this.dbToSync);
    if (result?.error) this.remoteRequestErrorHandler(entity.id, "CREATE", result?.error);
  }

  private async onLocalUpdate(entity : SyncableObject, table : string) {
    const operation = await this.getPendingOperation("UPDATE", "DEXIE", table, entity.id)
    if (operation !== undefined) {
      await this.operationDb.pendingOperations.delete(operation.id);
      return;
    }
    console.log(`[Dexie] Updated ${table} → pushing to Supabase`, entity);
    const result = await this.push(entity, table as keyof typeof this.dbToSync);
    if (result?.error) this.remoteRequestErrorHandler(entity.id, "UPDATE", result?.error);
  }

  private async onLocalDelete(key : string, table : string) {
    const operation = await this.getPendingOperation("DELETE", "DEXIE", table, key)
    if (operation !== undefined) {
      await this.operationDb.pendingOperations.delete(operation.id);
      return;
    }
    console.log(`[Dexie] Deleted ${table} → deleting in Supabase`);
    const result = await this.delete(key, table as keyof typeof this.dbToSync);
    if (result?.error) this.remoteRequestErrorHandler(key, "DELETE", result?.error);
  }

  // TODO update lastPull more often to reduce pullUpdates duration
  private async onRemoteInsert(payload: RealtimePostgresInsertPayload<Backup>) : Promise<void> {
    if (payload.new.updated_by === this.userId) {
      await this.removePendingOperation(
        "CREATE",
        "SUPABASE",
        payload.new.object_type,
        payload.new.object_id
      )
      return;
    }

    console.log(`[Supabase] Add ${payload.new.object_type} → adding to dexie`);
    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler(payload.new.object_id, "CREATE", error);
  }

  // TODO update lastPull more often to reduce pullUpdates duration
  private async onRemoteUpdate(payload: RealtimePostgresUpdatePayload<Backup>) : Promise<void> {
    if (payload.new.updated_by === this.userId) {
      await this.removePendingOperation(
        payload.new.deleted_at !== null ? "DELETE" : "UPDATE",
        "SUPABASE",
        payload.new.object_type,
        payload.new.object_id
      )
      return;
    }
    console.log(`[Supabase] Updated ${payload.new.object_type} → update in dexie`, uint8ToSyncable(decodeUintFromJSONB(payload.new.content)));
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
      return await this.applyRemoteDelete(backup);
    }

    const { object_id, object_type, content } = backup;
    const remote = decodeUintFromJSONB(content);
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

    const operation = await this.getPendingOperation('UPDATE', 'SUPABASE', object_type, object_id);
    let finalObject : SyncableObject;
    if (operation !== undefined) {
      finalObject = uint8ToSyncable(mergeDocs({ doc: uint8toDoc(syncableToUint8(local)), date: operation.date
      }, { doc: uint8toDoc(remote), date: new Date(backup.updated_at) }).remote);
      console.log("merging", local, uint8ToSyncable(remote));
    } else {
      finalObject = uint8ToSyncable(remote);
    }

    console.log(`[Supabase] Applying remote ${object_type} ${object_id}`, finalObject);
    await this.addPendingOperation("UPDATE", "DEXIE", backup.object_type, backup.object_id);
    try {
      await table.put(finalObject);
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
    if (object_type === undefined) return { error: null };

    const table = this.dbToSync[object_type as keyof typeof this.dbToSync] as unknown as EntityTable<SyncableObject, 'id'>;

    const local = await table.get(object_id);
    if (local === undefined) return {error: null};

    await this.addPendingOperation("DELETE", "DEXIE", object_type, object_id);
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
    // TODO : error handler 406 et 409
    console.log(`[Supabase] Remote ${operation} on ${key} failed: ${error.message}`, error);
  }

  private localRequestErrorHandler(key : string, operation: "CREATE" | "UPDATE" | "DELETE", error : DexieError) : void {
    // TODO : error handler 406 et 409
    console.log(`[Dexie] Local ${operation} on ${key} failed: ${error.message}`, error);
  }

  private isDexieError(err: any): err is DexieError {
    return err && typeof err === 'object' && typeof err.name === 'string' && err.name.startsWith('Dexie');
  }

  public async destroy(): Promise<void> {
    await this.realtimeListener?.removeExistingChannel();
    this.authStateListener?.unsubscribe();
    window.removeEventListener('online', () => void this.realtimeListener?.subscribe());
    window.removeEventListener('offline', () => void this.realtimeListener?.removeExistingChannel());
  }
}
