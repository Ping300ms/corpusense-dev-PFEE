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
import { SyncableObject, SyncableObjectNames, SyncableTables } from '@/data/models/Syncable.ts';
import Backup from '@/data/models/Backup.ts';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';
import { ListenerState, SupabaseRealtimeListener } from '@/data/repositories/supabase/SupabaseRealtimeListener.ts';
import { SupabaseListenerProperties } from '@/data/repositories/supabase/SupabaseListenerProperties.ts';
import { SyncPendingOperations } from '@/data/models/SyncPendingOperations.ts';
import { v4 as uuid } from 'uuid';
import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel.ts';
import { MergeParameters } from '@/data/repositories/supabase/__test__/mergeParameters.ts';

export class SyncManager {
  //region Variables
  private readonly defaultPullDate = '2003-01-05T08:01:00Z'; // date before project start
  private static instance: SyncManager | null = null;

  private static operationTimings: Record<string, number> = {}; // id -> start time
  private static operationDurations: number[] = [];

  private readonly client: SupabaseClient;
  private readonly dbToSync: typeof db;
  private readonly operationDb: typeof dbSync;
  private lastPull: Date = new Date(this.defaultPullDate);
  private userId: string | null = null;
  private isSyncing = false;

  private realtimeListener: SupabaseRealtimeListener<Backup> | null = null;
  private authStateListener: Subscription | null = null;
  //endregion

  private constructor(client: SupabaseClient = supabase,
                      dbToSync: typeof db = db,
                      operationDb: typeof dbSync = dbSync
  ) {
    this.client = client;
    this.dbToSync = dbToSync;
    this.operationDb = operationDb;

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

  public getState(): ListenerState {
    const state = this.realtimeListener?.getState();
    if (state == undefined) return ListenerState.DISCONNECTED;
    return state;
  }

  //region Perf measurements
  private static startTimer(id: string) {
    SyncManager.operationTimings[id] = performance.now();
  }

  private static endTimer(id: string) {
    const start = SyncManager.operationTimings[id];
    if (start !== undefined) {
      const duration = performance.now() - start;
      SyncManager.operationDurations.push(duration);
      delete SyncManager.operationTimings[id];

      const total = SyncManager.operationDurations.reduce((a, b) => a + b, 0);
      const avg = total / SyncManager.operationDurations.length;
      const max = Math.max(...SyncManager.operationDurations);

      console.log(
        `[⏱️ SyncManager] Operation ${id} completed in ${duration.toFixed(2)}ms | ` +
        `avg: ${avg.toFixed(2)}ms | max: ${max.toFixed(2)}ms`
      );
    }
  }
  //endregion

  private initializeListeners() {
    // Dexie → Supabase
    new DexieObservableListener(
      this.dbToSync,
      {
      onAdd: (newObject, table) => this.onLocalInsert(newObject, table),
      onUpdate: (newObject, oldObject, table) => this.onLocalUpdate(newObject, oldObject, table),
      onDelete: (key, table) => this.onLocalDelete(key, table),
    });

    // Supabase → Dexie
    this.realtimeListener = new SupabaseRealtimeListener<Backup>(
      {
        tableName : "backup",
        channelBaseName : "backup",
        onInsert : (p) => this.onRemoteInsert(p),
        onUpdate : (p) => this.onRemoteUpdate(p),
        onDelete : (p) => this.onRemoteDelete(p),
        onSubscribed : () => this.InitSync(),
        supabaseClient : this.client,
      } as SupabaseListenerProperties<Backup>);

    this.authStateListener = this.client.auth.onAuthStateChange((_event) => {
      switch (_event) {
        case 'SIGNED_IN':
          void this.onSignedIn();
          break;
        case 'SIGNED_OUT':
          void this.onSignedOut();
          break;
      }
    }).data.subscription;

    window.addEventListener('online', () => void this.realtimeListener?.subscribe());
    window.addEventListener('offline', () => void this.realtimeListener?.removeExistingChannel());
  }

  //region Supabase CRUD
  public async read(object_id: string, type: SyncableObjectNames) : Promise<{ data: null, error: PostgrestError} | { data: Backup | null, error: null}> {
    const {data, error} = await this.client
      .from("backup")
      .select()
      .eq("object_id", object_id)
      .eq("object_type", type)
      .is('deleted_at', null)
      .maybeSingle<Backup>();
    if (error !== null) return {data: null, error};
    return {data, error: null};
  }

  public async create(obj: SyncableObject, type: SyncableObjectNames, op? : SyncPendingOperations): Promise<{ data: null, error: PostgrestError} | { data: SyncableObject, error: null} | null> {
    if (op == undefined) op = await this.addPendingOperation("CREATE", "SUPABASE", type, obj.id);
    const userId = await this.getUser();
    if (userId == null) return null;
    let part_of : string | null = null;
    if (type === "annotations" || type === "collectionContents") {
      const { data, error } = await this.read(
        type === "annotations" ? (obj as Annotation).collectionId : (obj as CollectionContent).id
        , "collections"
      );

      if (error !== null) return {data: null, error};
      if (data == null || data.id == undefined) {
        console.error(`collection backup of ${type} ${obj.id} not found`, data, obj);
        return null;
      }
      part_of = data.id;
    }

    const { error } = await this.client.from('backup').upsert<Backup>({
      owner_id: userId,
      object_id: obj.id,
      object_type: type,
      content: obj,
      updated_at: op.date.toISOString(),
      change_id: op.id,
      deleted_at: null,
      part_of
    } as Backup);

    if (error) return { data: null, error};
    return {data: obj, error: null};
  }

  public async delete(id: string, type: SyncableObjectNames, op? : SyncPendingOperations): Promise<{ data: null, error: PostgrestError} | { data: string, error: null} | null> {
    if (op == undefined) op = await this.addPendingOperation("DELETE", "SUPABASE", type, id);

    const userId = await this.getUser();
    if (userId == null) return null;

    const { error } = await this.client
      .from('backup')
      .update({ deleted_at: op.date.toISOString(), updated_at: op.date.toISOString(), change_id: op.id })
      .eq('object_id', id)
      .eq('object_type', type)
      .select()
      .maybeSingle<Backup>();

    if (error)
      return { data: null, error};
    return {data: id, error: null};
  }

  public async push(newObj: SyncableObject, type: SyncableObjectNames, op? : SyncPendingOperations): Promise<{ data: null, error: PostgrestError} | { data: SyncableObject, error: null} | null> {
    if (op == undefined) op = await this.addPendingOperation("UPDATE", "SUPABASE", type, newObj.id);

    const userId = await this.getUser();
    if (userId == null) return null;

    const { data: remote, error : selectError } = await this.client
      .from('backup')
      .select('content, updated_at, deleted_at')
      .eq('object_id', newObj.id)
      .eq('object_type', type)
      .select()
      .maybeSingle<Backup>();

    if (selectError) return { data: null, error: selectError };

    if (remote?.content != null) {
      newObj = this.merge(newObj, op.date, remote.content, new Date(remote.updated_at), type, op.old);

      // check if CollectionContent update CollectionDetails.contentSize

      // Save merge to local
      await this.addPendingOperation("UPDATE", "DEXIE", type, newObj.id);
      const table = this.dbToSync[type] as EntityTable<SyncableObject, 'id'>;
      await table.update(newObj.id, newObj);
    }

    const { error: upsertError } = await this.client.from('backup').upsert<Backup>(
      {
        owner_id: this.userId,
        object_id: newObj.id,
        object_type: type,
        content: newObj,
        updated_at: op.date.toISOString(),
        change_id: op.id,
        deleted_at: remote?.deleted_at ?? null,
      } as Backup,
      { onConflict: 'owner_id,object_type,object_id' }
    );

    if (upsertError) return { data: null, error: upsertError};
    return {data: newObj, error: null};
  }
  //endregion

  //region Pending operation utils
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

  private async addPendingOperation(
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    location: 'DEXIE' | 'SUPABASE',
    table: string,
    object_id: string,
    old : SyncableObject | null = null
  ): Promise<SyncPendingOperations> {
    const existing = await this.getPendingOperation(type, location, table, object_id);

    let res: SyncPendingOperations;
    if (existing === undefined) {
      res = {
        id: uuid(),
        type,
        location,
        table,
        object_id,
        date: new Date(),
        old
      } as SyncPendingOperations;
      await this.operationDb.pendingOperations.add(res);
    } else {
      // don't know if its necessary to update old
      res = { ...existing, date: new Date() } as SyncPendingOperations;
      await this.operationDb.pendingOperations.update(existing.id, res);
    }

    SyncManager.startTimer(res.id);
    return res;
  }

  private async removePendingOperation(id: string) {
    await this.operationDb.pendingOperations.delete(id);
    SyncManager.endTimer(id);
  }
  //endregion

  //region Synchronization
  public async replayPendingOperations(): Promise<void> {
    const pending = await this.operationDb.pendingOperations.orderBy('date')
      .filter((op) => op.location === "SUPABASE"
      ).toArray();

    console.log(`[SyncManager] Replaying ${pending.length} pending operations`);
    for (const op of pending) {
      //console.log(`[SyncManager] Replaying pending ${op.type} → ${op.table}:${op.object_id}`);

      switch (op.type) {
        case "CREATE": {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (!obj) {
            await this.removePendingOperation(op.id);
            break;
          }
          const res = await this.create(obj, op.table, op);
          if (res?.error != undefined) {
            if (res.error.code === "23505") await this.removePendingOperation(op.id);
            else this.remoteRequestErrorHandler(op.object_id, op.type, res.error);
          }
          break;
        }
        case "UPDATE": {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (!obj) {
            await this.removePendingOperation(op.id);
            break;
          }
          const res = await this.push(obj, op.table, op);
          if (res?.error) this.remoteRequestErrorHandler(op.object_id, op.type, res.error);
          break;
        }
        case "DELETE": {
          const obj = await this.client.from('backup').select('deleted_at').eq('object_id', op.object_id).eq('object_type', op.table).maybeSingle();
          if (obj.data == null || obj.data.deleted_at != null) {
            await this.removePendingOperation(op.id);
            break;
          }
          const res = await this.delete(op.object_id, op.table, op);
          if (res?.error) this.remoteRequestErrorHandler(op.object_id, op.type, res.error);
          break;
        }
      }
    }
    console.log(`[SyncManager] Replaying operations finished`);
  }

  public async pullUpdates(): Promise<{ error: string } | null> {
    const start = performance.now(); // ⏱️ start timer

    const user = await this.getUser();
    if (user == null) {
      console.log(`[⏱️ SyncManager] pullUpdates aborted (not logged in)`);
      return { error: `[SELECT] Sync: error not logged in` };
    }

    const requestDate = new Date();

    for (const type of SyncableTables) {
      // TODO check pull limit 1000
      const { data: remotes, error } = await this.client
        .from('backup')
        .select('object_id, content, updated_at, deleted_at')
        .eq('object_type', type)
        .gt('updated_at', this.lastPull?.toISOString() ?? this.defaultPullDate)
        .order('updated_at', { ascending: true });

      if (error) {
        this.remoteRequestErrorHandler("", "GET", error)
        console.log(`[⏱️ SyncManager] pullUpdates(${String(type)}) failed in ${(performance.now() - start).toFixed(2)} ms`);
        return { error: `[PULL] Sync: error pulling from Supabase ${type} updates ${error.message}` };
      }

      if (remotes == null || remotes.length === 0) {
        console.log(`[⏱️ SyncManager] pullUpdates(${String(type)}) completed (no updates) in ${(performance.now() - start).toFixed(2)} ms`);
        return null;
      }

      const objectIds: string[] = remotes.map<string>((backup) => backup.object_id as string);

      const table = this.dbToSync[type] as unknown as EntityTable<SyncableObject, 'id'>;
      const locals = await table.bulkGet(objectIds);

      const toCreate: SyncableObject[] = [];
      const toUpdate: SyncableObject[] = [];
      const toDelete: string[] = [];
      const syncOperations: SyncPendingOperations[] = [];

      for (let i = 0; i < locals.length; i++) {
        const remote = remotes[i];
        const local = locals[i];

        if (remote.deleted_at != null) {
          if (!local) continue;
          syncOperations.push({
            id: uuid(),
            type: "DELETE",
            location: "DEXIE",
            object_id: remote.object_id as string,
            table: type,
            date: new Date(),
            old: null
          });
          toDelete.push(remote.object_id as string);
          continue;
        }

        if (!local) {
          syncOperations.push({
            id: uuid(),
            type: "CREATE",
            location: "DEXIE",
            object_id: remote.object_id as string,
            table: type,
            date: new Date(),
            old: null
          });
          toCreate.push(remote.content as SyncableObject);
          continue;
        }

        const operation = await this.getPendingOperation("UPDATE", "SUPABASE", type, local.id);
        if (operation != undefined) continue; // replay pending will be in charge of the merge

        syncOperations.push({
          id: uuid(),
          type: "UPDATE",
          location: "DEXIE",
          object_id: local.id,
          table: type,
          date: new Date(),
          old: null
        });
        toUpdate.push(remote.content as SyncableObject);
      }

      await this.operationDb.pendingOperations.bulkAdd(syncOperations);
      await table.bulkDelete(toDelete);
      await table.bulkAdd(toCreate);
      await table.bulkPut(toUpdate);

      console.log(`[⏱️ SyncManager] pull ${type} updates completed (${remotes.length} changes)`);
    }

    localStorage.setItem(`${this.userId}-lastPull`, requestDate.toString());
    this.lastPull = requestDate;

    const duration = performance.now() - start;
    console.log(`[⏱️ SyncManager] pullUpdates completed in ${duration.toFixed(2)} ms`);

    return null;
  }
  //endregion

  public async Share(_objectId: string, _sharedUserMail: string): Promise<{ error: string } | null> {
    return null;
  }

  //region Local handler
  // TODO adapt to handle bulk
  private async onLocalInsert(entity : SyncableObject, table : SyncableObjectNames) {
    const operation = await this.getPendingOperation("CREATE", "DEXIE", table, entity.id)
    if (operation !== undefined) {
      await this.removePendingOperation(operation.id);
      return;
    }
    if (this.userId !== null) console.log(`[Dexie] Added ${table} → pushing to Supabase`);
    const result = await this.create(entity, table);
    if (result?.error) this.remoteRequestErrorHandler(entity.id, "CREATE", result?.error);
  }

  private async onLocalUpdate(newObject : SyncableObject, oldObject : SyncableObject, table : SyncableObjectNames) {
    const operation = await this.getPendingOperation("UPDATE", "DEXIE", table, newObject.id)
    if (operation !== undefined) {
      await this.removePendingOperation(operation.id);
      return;
    }
    if (this.userId !== null) console.log(`[Dexie] Updated ${table} → pushing to Supabase`, newObject);
    const op = await this.addPendingOperation("UPDATE", "SUPABASE", table, newObject.id, oldObject);
    const result = await this.push(newObject, table, op);
    if (result?.error) this.remoteRequestErrorHandler(newObject.id, "UPDATE", result?.error);
  }

  private async onLocalDelete(key : string, table : SyncableObjectNames) {
    const operation = await this.getPendingOperation("DELETE", "DEXIE", table, key)
    if (operation !== undefined) {
      await this.removePendingOperation(operation.id);
      return;
    }
    if (this.userId !== null) console.log(`[Dexie] Deleted ${table} → deleting in Supabase`);
    const result = await this.delete(key, table);
    if (result?.error) this.remoteRequestErrorHandler(key, "DELETE", result?.error);
  }
  //endregion

  //region Remote handler
  private async onRemoteInsert(payload: RealtimePostgresInsertPayload<Backup>) : Promise<void> {
    const operation = await this.operationDb.pendingOperations.get(payload.new.change_id);
    if (operation !== undefined) {
      await this.removePendingOperation(operation.id);
      return;
    }

    console.log(`[Supabase] Add ${payload.new.object_type} → adding to dexie`);
    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler(payload.new.object_id, "CREATE", error);
    else localStorage.setItem(`${this.userId}-lastPull`, payload.new.updated_at);
  }

  private async onRemoteUpdate(payload: RealtimePostgresUpdatePayload<Backup>) : Promise<void> {
    const operation = await this.operationDb.pendingOperations.get(payload.new.change_id);
    if (operation !== undefined) {
      await this.removePendingOperation(operation.id);
      return;
    }

    console.log(`[Supabase] Updated ${payload.new.object_type} → update in dexie`, payload.new.content);
    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler(payload.new.object_id, "UPDATE", error);
    else localStorage.setItem(`${this.userId}-lastPull`, payload.new.updated_at);
  }

  private async onRemoteDelete(payload: RealtimePostgresDeletePayload<Backup>) : Promise<void> {
    if (payload.old == null) return;
    console.log(`[Supabase] Delete ${payload.old.object_type} → delete in dexie`);
    const { error } = await this.applyRemoteDelete(payload.old);
    if (error && payload.old.object_id != null) this.localRequestErrorHandler(payload.old.object_id, "DELETE", error);
  }

  private async applyRemoteChange(backup: Backup): Promise<{error: DexieError | null}> {
    if (backup.deleted_at != null) { // remote has been soft deleted
      return await this.applyRemoteDelete(backup);
    }

    const { object_id, object_type, content } = backup;
    const table = this.dbToSync[object_type as keyof typeof this.dbToSync] as unknown as EntityTable<SyncableObject, 'id'>;
    const local = await table.get(object_id);

    // TODO check annotation for prev and next to be valid

    if (local === undefined) { // local doesn't exist
      await this.addPendingOperation("CREATE", "DEXIE", backup.object_type, backup.object_id);
      try {
        await table.add(content);
      } catch (err : unknown) {
        if (this.isDexieError(err)) {
          this.localRequestErrorHandler(object_id, "CREATE", err);
          return { error: err };
        }
        throw err;
      }
      return { error: null };
    }

    console.log(`[Supabase] Applying remote ${object_type} ${object_id}`, content);
    await this.addPendingOperation("UPDATE", "DEXIE", backup.object_type, backup.object_id);
    try {
      await table.put(content);
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
  //endregion

  public async InitSync() {
    if (this.isSyncing) return; // prevent parallel syncing
    this.isSyncing = true;
    await this.pullUpdates();
    await this.replayPendingOperations();
    this.isSyncing = false;
  }

  //region Auth handlers
  // TODO maybe purge/redo DEXIE operations at start
  private async onSignedIn() {
    await this.realtimeListener?.subscribe();
    const userId = await this.getUser();
    if (userId == null) return; // not supposed to happen
    const lastPull = localStorage.getItem(`${userId}-lastPull`);
    if (lastPull !== null) this.lastPull = new Date(lastPull);
  }

  private async onSignedOut() {
    this.userId = null;
    this.lastPull = new Date(this.defaultPullDate);
    await this.realtimeListener?.removeExistingChannel();
  }
  //endregion

  private merge(newLocal : SyncableObject, localDate : Date, remote : SyncableObject, remoteDate : Date, type: SyncableObjectNames, oldLocal : SyncableObject | null = null) : SyncableObject {
    const param = {
      newLocal,
      localDate,
      remote,
      remoteDate,
      oldLocal,
    };
    switch (type) {
      case 'annotations':
        return this.mergeAnnotation(param as MergeParameters<Annotation>);
      case 'collections':
        return this.mergeCollectionDetails(param as MergeParameters<CollectionDetails>);
      case 'collectionContents':
        return this.mergeCollectionContent(param as MergeParameters<CollectionContent>);
      case 'models':
        return this.mergeDataModels(param as MergeParameters<DataModel>);
    }
  }

  private mergeString(param : MergeParameters<string>) : string {
    // changes made on top of remote or no changes
    if (param.oldLocal === param.remote || param.newLocal === param.remote)
      return param.newLocal;
    if (param.newLocal.length <= 36) // uuid length === 36
      return param.localDate > param.remoteDate ? param.newLocal : param.remote;

    // simplest concat logic
    // will be fixed by user intervention for now
    // FIXME
    return param.remote + param.newLocal;
  }

  private mergeAnnotation(param : MergeParameters<Annotation>) : Annotation {
    // next and prev must be determinist : change new locals order to last remote order + 1
    // TODO ask check precise next, prev and partOf logic
    return param.newLocal;
  }

  private mergeCollectionDetails(param : MergeParameters<CollectionDetails>) : CollectionDetails {
    return param.newLocal;
  }

  private mergeCollectionContent(param : MergeParameters<CollectionContent>) : CollectionContent {
    // content must be determinist : change new locals CollectionElements must be placed at the end of remote
    // TODO
    return param.newLocal;
  }

  private mergeDataModels(param : MergeParameters<DataModel>) : DataModel {
    return param.newLocal;
  }

  //region Error handlers
  private remoteRequestErrorHandler(key : string, operation: "CREATE" | "UPDATE" | "DELETE" | "GET", error : PostgrestError) : void {
    console.log(`[Supabase] Remote ${operation} on ${key} failed: ${error.message}`, error);
  }

  private localRequestErrorHandler(key : string, operation: "CREATE" | "UPDATE" | "DELETE" | "GET", error : DexieError) : void {
    console.log(`[Dexie] Local ${operation} on ${key} failed: ${error.message}`, error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isDexieError(err: any): err is DexieError {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call
    return err != null && typeof err === 'object' && typeof err.name === 'string' && err.name.startsWith('Dexie');
  }
  //endregion

  private async getUser(): Promise<string | null> {
    if (this.userId == null)
      this.userId = (await this.client.auth.getUser()).data.user?.id ?? null;
    return this.userId;
  }

  public async destroy(): Promise<void> {
    await this.realtimeListener?.removeExistingChannel();
    this.authStateListener?.unsubscribe();
    window.removeEventListener('online', () => void this.realtimeListener?.subscribe());
    window.removeEventListener('offline', () => void this.realtimeListener?.removeExistingChannel());
  }
}
