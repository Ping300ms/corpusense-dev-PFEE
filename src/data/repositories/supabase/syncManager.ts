import {
  PostgrestError,
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  Subscription,
  SupabaseClient,
} from '@supabase/supabase-js';
import { db, dbSync } from '@/data/repositories/indexeddb/db.ts';
import { DexieError, EntityTable } from 'dexie';
import { supabase } from '@/data/repositories/supabase/supabaseClient.ts';
import { SyncableObject, SyncableObjectName, SyncableTables } from '@/data/models/Syncable.ts';
import Backup from '@/data/models/Backup.ts';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';
import { ListenerState, SupabaseRealtimeListener } from '@/data/repositories/supabase/SupabaseRealtimeListener.ts';
import { SupabaseListenerProperties } from '@/data/repositories/supabase/SupabaseListenerProperties.ts';
import { SyncPendingOperation } from '@/data/models/SyncPendingOperation.ts';
import { v4 as uuid } from 'uuid';
import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { merge } from '@/data/repositories/supabase/mergeUtils.ts';
import { BackupShares } from '@/data/models/BackupShares.ts';
import { DataModel } from '@/data/models/DataModel.ts';
import { isEqual } from 'lodash';
import { ICreateChange, IDatabaseChange, IDeleteChange, IUpdateChange } from 'dexie-observable/api';

export class SyncManager {
  private static instance: SyncManager | null = null;
  //region Variables
  private readonly backupTableName: string = 'backup';
  private readonly defaultPullDate = '2003-01-05T08:01:00Z'; // date before project start
  private readonly client: SupabaseClient;
  private readonly dbToSync: typeof db;
  private readonly operationDb: typeof dbSync;
  private lastPull: Date = new Date(this.defaultPullDate);
  private userId: string | null = null;
  private isSyncing = false;
  // sharing purpose, no need to have the exact remote version, only ids and owner_ids are useful
  private collectionBackupCache = new Map<string, Backup>(); // collectionId: backup

  private realtimeListener: SupabaseRealtimeListener | null = null;
  private authStateListener: Subscription | null = null;

  //endregion

  public static getInstance(
    client: typeof supabase = supabase,
    dbToSync: typeof db = db,
    operationDb: typeof dbSync = dbSync,
  ): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager(client, dbToSync, operationDb);
    return SyncManager.instance;
  }

  private constructor(client: SupabaseClient = supabase,
                      dbToSync: typeof db = db,
                      operationDb: typeof dbSync = dbSync,
  ) {
    this.client = client;
    this.dbToSync = dbToSync;
    this.operationDb = operationDb;

    this.initializeListeners();
  }

  //region Initialization
  private initializeListeners() {
    // Dexie → Supabase
    new DexieObservableListener(
      this.dbToSync,
      {
        onInsert: (changes) => this.onLocalInsert(changes),
        onUpdate: (changes) => this.onLocalUpdate(changes),
        onDelete: (changes) => this.onLocalDelete(changes),
      });

    // Supabase → Dexie
    this.realtimeListener = new SupabaseRealtimeListener(
      {
        tableName: this.backupTableName,
        channelBaseName: this.backupTableName,
        onInsert: (p) => {void this.onRemoteInsert(p)},
        onUpdate: (p) => {void this.onRemoteUpdate(p)},
        onDelete: (p) => {void this.onRemoteDelete(p)},
        onSubscribed: () => {void this.InitSync()},
        onShared: (p) => {void this.onShared(p)},
        supabaseClient: this.client,
      } as SupabaseListenerProperties);

    this.authStateListener = this.client.auth.onAuthStateChange((_event) => {
      switch (_event) {
        case 'SIGNED_IN':
          // timeout prevent null return from auth.getUser()
          setTimeout(() => void this.onSignedIn(), 1000);
          break;
        case 'SIGNED_OUT':
          void this.onSignedOut();
          break;
      }
    }).data.subscription;

    window.addEventListener('online', () => void this.realtimeListener?.subscribe());
    window.addEventListener('offline', () => void this.realtimeListener?.removeExistingChannel());
  }

  public async InitSync() {
    if (this.isSyncing) return; // prevent parallel syncing
    this.isSyncing = true;
    await this.pullUpdates();
    await this.replayPendingOperations();
    this.isSyncing = false;
  }
  //endregion

  //region Supabase CRUD
  public async read(object_id: string, type: SyncableObjectName) {
    const { data, error } = await this.client
      .from(this.backupTableName)
      .select<'*', Backup>()
      .eq('object_id', object_id)
      .eq('object_type', type)
      .is('deleted_at', null)
      .maybeSingle<Backup>();

    if (error !== null) return { data: null, error };
    if (data == null) return null; // value not found
    if (data.object_type === "collections") this.collectionBackupCache.set(data.object_id, data)
    return { data, error: null };
  }

  public async readMultiple(objects_id: string[], type: SyncableObjectName): Promise<{ data: null, error: PostgrestError } | {
    data: Map<string, Backup>, // key: object_id
    error: null
  }> {
    const { data, error } = await this.client
      .from(this.backupTableName)
      .select<'*', Backup>()
      .in('object_id', objects_id)
      .eq('object_type', type)
      .is('deleted_at', null);

    if (error !== null) return { data: null, error };

    const res = new Map<string, Backup>();
    data.forEach(v => {
      if (v.object_type === "collections") this.collectionBackupCache.set(v.object_id, v);
      res.set(v.object_id, v);
    })
    return { data: res, error: null };
  }

  // op is only useful in replay mode and must be corresponding to objects list order
  public async create(objects: SyncableObject[], type: SyncableObjectName, op?: SyncPendingOperation[]): Promise<SyncableObject | null> {
    if (op == undefined) op = await this.addPendingOperations('CREATE', 'SUPABASE', type, [{ object_id: objects.id }]);
    const userId = await this.getUser();
    if (userId == null) return null;

    let part_of: string | null = null;
    if (type === 'annotations' || type === 'collectionContents') {
      const { data, error } = await this.readMultiple(
        type === 'annotations' ? (objects as Annotation).collectionId : (objects as CollectionContent).id
        , 'collections',
      );

      if (error !== null) {
        this.remoteRequestErrorHandler(objects.id, 'GET', error);
        return null;
      }
      if (data == null || data.id == undefined) {
        console.error(`collection backup of ${type} ${objects.id} not found`, data, objects);
        return null;
      }
      part_of = data.id;
    }

    const { error } = await this.client.from(this.backupTableName).insert<Backup>({
      owner_id: userId,
      object_id: objects.id,
      object_type: type,
      content: objects,
      updated_at: op.date.toISOString(),
      change_id: op.id,
      deleted_at: null,
      part_of,
    } as Backup);

    if (error?.code === '23505') await this.removePendingOperations(op.id);
    else if (error !== null) this.remoteRequestErrorHandler(op.object_id, op.type, error);

    return error ? null : objects;
  }

  public async delete(id: string[], type: SyncableObjectName, op?: SyncPendingOperation[]): Promise<string | null> {
    if (op == undefined) op = await this.addPendingOperations('DELETE', 'SUPABASE', type, id);

    const userId = await this.getUser();
    if (userId == null) return null;

    const { error } = await this.client
      .from(this.backupTableName)
      .update({ deleted_at: op.date.toISOString(), updated_at: op.date.toISOString(), change_id: op.id })
      .eq('object_id', id)
      .eq('object_type', type)
      .select()
      .maybeSingle<Backup>();

    if (error !== null) this.remoteRequestErrorHandler(id, 'DELETE', error);

    return error ? null : id;
  }

  public async push(objects: SyncableObject[], type: SyncableObjectName, op?: SyncPendingOperation[]): Promise<SyncableObject | null> {
    if (op == undefined) op = await this.addPendingOperations('UPDATE', 'SUPABASE', type, objects.id);
    
    const userId = await this.getUser();
    if (userId == null) return null;

    const { data: remote, error: selectError } = await this.client
      .from(this.backupTableName)
      .select('content, updated_at, deleted_at')
      .eq('object_id', objects.id)
      .eq('object_type', type)
      .select()
      .maybeSingle<Backup>();

    if (selectError !== null) {
      this.remoteRequestErrorHandler(objects.id, 'GET', selectError);
      return null
    }

    if (remote?.content == null) { // insert
      await this.removePendingOperations(op.id);
      return this.create(objects, type);
    }

    const merged = merge(objects, op.date, remote.content, new Date(remote.updated_at), type, op.old);

    // TODO if CollectionContent update CollectionDetails.contentSize
    // TODO if Annotation and order change update all Annotations order

    // Save merge to local
    if (!isEqual(objects, merged)) {
      await this.addPendingOperations('UPDATE', 'DEXIE', type, merged.id);
      const table = this.dbToSync[type] as EntityTable<SyncableObject, 'id'>;
      await table.update(merged.id, merged);
    }

    const { error: updateError } = await this.client.from(this.backupTableName).update<Backup>(
      {
        owner_id: remote.owner_id,
        object_id: remote.object_id,
        object_type: remote.object_type,
        content: merged,
        updated_at: op.date.toISOString(),
        change_id: op.id,
        deleted_at: remote.deleted_at,
        part_of: remote.part_of,
      },
    ).eq('id', remote.id).maybeSingle();
    if (updateError !== null) this.remoteRequestErrorHandler(merged.id, 'UPDATE', updateError);

    return updateError ? null : merged;
  }
  //endregion

  //region Synchronization
  public async replayPendingOperations(): Promise<void> {
    const pending = (await this.operationDb.pendingOperations.orderBy('date')
      .filter((op) => op.location === 'SUPABASE',
      ).toArray()).sort((a, b) =>
      (a.table === "collections" ? 0 : 1) - (b.table === "collections" ? 0 : 1));

    console.log(`[SyncManager] Replaying ${pending.length} pending operations`);
    for (const op of pending) {
      //console.log(`[SyncManager] Replaying pending ${op.type} → ${op.table}:${op.object_id}`);

      switch (op.type) {
        case 'CREATE': {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (!obj) {
            await this.removePendingOperations(op.id);
            break;
          }
          if (op.table === "collections")
            await this.create(obj, op.table, op)
          else void this.create(obj, op.table, op);
          break;
        }
        case 'UPDATE': {
          const table = this.dbToSync[op.table as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
          const obj = await table.get(op.object_id);
          if (!obj) {
            await this.removePendingOperations(op.id);
            break;
          }
          void this.push(obj, op.table, op);
          break;
        }
        case 'DELETE': {
          const obj = await this.client.from(this.backupTableName).select('deleted_at').eq('object_id', op.object_id).eq('object_type', op.table).maybeSingle();
          if (obj.data == null || obj.data.deleted_at != null) {
            await this.removePendingOperations(op.id);
            break;
          }
          void this.delete(op.object_id, op.table, op);
          break;
        }
      }
    }
    console.log(`[SyncManager] Replaying operations finished`);
  }

  public async pullUpdates(): Promise<{ error: string } | null> {
    // TODO refactor pull perf
    const start = performance.now();

    const user = await this.getUser();
    if (user == null) {
      console.log(`[⏱️ SyncManager] pullUpdates aborted (not logged in)`);
      return { error: `[SELECT] Sync: error not logged in` };
    }

    const requestDate = new Date();

    for (const table of SyncableTables) {
      // FIXME pagination to pull over read limit 1000
      const { data: remotes, error } = await this.client
        .from(this.backupTableName)
        .select('object_id, content, updated_at, deleted_at')
        .eq('object_type', table)
        .gt('updated_at', this.lastPull?.toISOString() ?? this.defaultPullDate)
        .order('updated_at', { ascending: true });

      if (error) {
        this.remoteRequestErrorHandler('', 'GET', error);
        console.log(`[⏱️ SyncManager] pullUpdates(${String(table)}) failed in ${(performance.now() - start).toFixed(2)} ms`);
        return { error: `[PULL] Sync: error pulling from Supabase ${table} updates ${error.message}` };
      }

      if (remotes == null || remotes.length === 0) {
        console.log(`[⏱️ SyncManager] pullUpdates(${String(table)}) completed (no updates) in ${(performance.now() - start).toFixed(2)} ms`);
        return null;
      }

      const objectIds: string[] = remotes.map<string>((backup) => backup.object_id as string);

      const dbTable = this.dbToSync[table] as unknown as EntityTable<SyncableObject, 'id'>;
      const locals = await dbTable.bulkGet(objectIds);
      const pendingUpdates = await this.getPendingOperations('UPDATE', 'SUPABASE', null, locals.filter(l => l !== undefined).map(l => l.id))

      const toCreate: SyncableObject[] = [];
      const toUpdate: SyncableObject[] = [];
      const toDelete: string[] = [];
      const syncOperations: SyncPendingOperation[] = [];

      for (let i = 0; i < locals.length; i++) {
        const remote = remotes[i];
        const local = locals[i];

        if (remote.deleted_at != null) {
          if (!local) continue;
          syncOperations.push({
            id: uuid(),
            type: 'DELETE',
            location: 'DEXIE',
            object_id: remote.object_id as string,
            table,
            date: new Date(),
            old: null,
          });
          toDelete.push(remote.object_id as string);
          continue;
        }

        if (!local) {
          syncOperations.push({
            id: uuid(),
            type: 'CREATE',
            location: 'DEXIE',
            object_id: remote.object_id as string,
            table: table,
            date: new Date(),
            old: null,
          });
          toCreate.push(remote.content as SyncableObject);
          continue;
        }

        if (pendingUpdates.get(local.id) != undefined) continue; // replay pending will be in charge of the merge

        syncOperations.push({
          id: uuid(),
          type: 'UPDATE',
          location: 'DEXIE',
          object_id: local.id,
          table: table,
          date: new Date(),
          old: null,
        });
        toUpdate.push(remote.content as SyncableObject);
      }

      await this.operationDb.pendingOperations.bulkAdd(syncOperations);
      await dbTable.bulkDelete(toDelete);
      await dbTable.bulkAdd(toCreate);
      await dbTable.bulkPut(toUpdate);

      console.log(`[⏱️ SyncManager] pull ${table} updates completed (${remotes.length} changes)`);
    }

    localStorage.setItem(`${this.userId}-lastPull`, requestDate.toString());
    this.lastPull = requestDate;

    const duration = performance.now() - start;
    console.log(`[⏱️ SyncManager] pullUpdates completed in ${duration.toFixed(2)} ms`);

    return null;
  }
  //endregion

  //region Share logic
  public async Share(objectId: string, sharedUserMail: string, type: 'collections' | 'models', permission: 'R' | 'RW' | 'RWD'): Promise<{
    error: string
  } | null> {
    const user = await this.getUser();
    if (user == null) return { error: `[SHARE] error not logged in` };

    let sharedObject = this.collectionBackupCache.get(objectId);
    if (sharedObject == undefined) {
      const res = await this.read(objectId, type)
      if (res == null) return { error: `[SHARE] object not sync yet` };
      if (res.error) return { error: res.error.message };
      sharedObject = res.data;
    }
    if (sharedObject.owner_id != user) return { error: 'you are not the owner' };

    const { data: shareResult, error: shareError } = (await supabase.rpc('share_backup_to_email', {
      target_email: sharedUserMail,
      target_backup_id: sharedObject.id,
      target_permission: permission,
    })) as { data: { success: boolean, message: string } | null, error: PostgrestError | null };

    if (shareError) { // Erreur SQL/RPC
      return { error: shareError.message };
    } else if (shareResult?.success === false) { // email inconnu ou autre validation interne
      return { error: shareResult.message };
    }

    return null; // success
  }

  public async onShared(payload: RealtimePostgresInsertPayload<BackupShares>) {
    console.log("A collection has been shared with you !");
    const { backup_id } = payload.new
    const { data, error } = await this.client
      .from(this.backupTableName)
      .select('content, object_type')
      .or(`id.eq.${backup_id},part_of.eq.${backup_id}`)
      .is("deleted_at", null)
    if (error) {
      console.error(error);
      return;
    }
    const annotations = [];
    for (const entity of data) {
      switch (entity.object_type) {
        case 'annotations':
          annotations.push(entity.content as Annotation);
          break;
        case 'collections':
          void this.dbToSync.collections.put(entity.content as CollectionDetails);
          break;
        case 'collectionContents'  :
          void this.dbToSync.collectionContents.put(entity.content as CollectionContent);
          break;
        case 'models':
          void this.dbToSync.models.put(entity.content as DataModel);
          break;
        default:
          break;
      }
    }

    void this.dbToSync.annotations.bulkPut(annotations);
  }

  //endregion

  //region Pending operation utils

  private async getPendingOperations(
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    target: 'DEXIE' | 'SUPABASE',
    table: SyncableObjectName | null,
    objects_id: string[],
  ): Promise<Map<string, SyncPendingOperation>> {
    const res: Map<string, SyncPendingOperation> = new Map();
    await this.operationDb.pendingOperations.filter(
      (op) =>
        op.type === type &&
        op.location === target &&
        (table == null || op.table === table) &&
        objects_id.includes(op.object_id)
    ).each(obj => res.set(obj.object_id, obj));
    return res;
  }


  private async addPendingOperations(
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    location: 'DEXIE' | 'SUPABASE',
    table: SyncableObjectName,
    objects: {object_id: string, old?: SyncableObject}[]
  ): Promise<SyncPendingOperation[]> {
    const existing = (await this.getPendingOperations(type, location, table, objects.map(o => o.object_id)));
    const toPut: SyncPendingOperation[] = []

    for (const object of objects) {
      const oldOperation = existing.get(object.object_id);
      if (oldOperation === undefined) {
        toPut.push({
          id: uuid(),
          type,
          location,
          table,
          object_id: object.object_id,
          date: new Date(),
          old: object.old ?? null,
        });
      } else {
        // don't update old because we want to keep the entity before any change
        toPut.push({ ...oldOperation, date: new Date() });
      }
    }

    await this.operationDb.pendingOperations.bulkPut(toPut);
    return toPut;
  }

  private async removePendingOperations(operations: SyncPendingOperation[]) {
    await this.operationDb.pendingOperations.bulkDelete(operations.map((o) => o.id));
    this.LogTime(operations);
  }

  //endregion

  //region Local handler

  private async filterLocalDoneOperations(objects: Map<string, IDatabaseChange>, type: "CREATE" | "UPDATE" | "DELETE", table: SyncableObjectName) {
    const ids = Array.from(objects.keys())
    const operations = await this.getPendingOperations(
      type,
      'DEXIE',
      table,
      ids
    );
    const toRemove: SyncPendingOperation[] = [];
    for (const id of ids) {
      const operation = operations.get(id);
      if (operation != undefined) {
        toRemove.push(operation);
        objects.delete(id)
      }
    }
    await this.removePendingOperations(toRemove);
  }

  private async onLocalInsert(changes: Map<SyncableObjectName, Map<string, ICreateChange>>) {
    for (const table of SyncableTables) {
      const objectsMap = changes.get(table);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'CREATE', table)

      const objects: SyncableObject[] = []
      objectsMap.forEach(v => objects.push(v.obj as SyncableObject))
      await this.create(objects, table)
    }
  }

  private async onLocalUpdate(changes: Map<SyncableObjectName, Map<string, IUpdateChange>>) {
    for (const table of SyncableTables) {
      const objectsMap = changes.get(table);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'UPDATE', table)

      const objects: SyncableObject[] = []
      objectsMap.forEach(v => objects.push(v.obj as SyncableObject))
      await this.push(objects, table)
    }
  }

  private async onLocalDelete(changes: Map<SyncableObjectName, Map<string, IDeleteChange>>) {
    for (const table of SyncableTables) {
      const objectsMap = changes.get(table);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'DELETE', table)

      await this.delete(Array.from(objectsMap.keys()), table)
    }
  }

  //endregion

  //region Remote handler
  private async onRemoteInsert(payload: RealtimePostgresInsertPayload<Backup>): Promise<void> {
    const operation = await this.operationDb.pendingOperations.get(payload.new.change_id);
    if (operation !== undefined) {
      await this.removePendingOperations([operation]);
      return;
    }

    console.log(`[Supabase] Add ${payload.new.object_type} → adding to dexie`);
    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler(payload.new.object_id, 'CREATE', error);
    else localStorage.setItem(`${this.userId}-lastPull`, payload.new.updated_at);
  }

  private async onRemoteUpdate(payload: RealtimePostgresUpdatePayload<Backup>): Promise<void> {
    const operation = await this.operationDb.pendingOperations.get(payload.new.change_id);
    if (operation !== undefined) {
      await this.removePendingOperations([operation]);
      return;
    }

    console.log(`[Supabase] Updated ${payload.new.object_type} → update in dexie`, payload.new.content);
    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler(payload.new.object_id, 'UPDATE', error);
    else localStorage.setItem(`${this.userId}-lastPull`, payload.new.updated_at);
  }

  private async onRemoteDelete(payload: RealtimePostgresDeletePayload<Backup>): Promise<void> {
    if (payload.old == null) return;
    console.log(`[Supabase] Delete ${payload.old.object_type} → delete in dexie`);
    const { error } = await this.applyRemoteDelete(payload.old);
    if (error && payload.old.object_id != null) this.localRequestErrorHandler(payload.old.object_id, 'DELETE', error);
  }

  private async applyRemoteChange(backup: Backup): Promise<{ error: DexieError | null }> {
    if (backup.deleted_at != null) { // remote has been soft deleted
      return await this.applyRemoteDelete(backup);
    }

    const { object_id, object_type, content } = backup;
    const table = this.dbToSync[object_type as keyof typeof this.dbToSync] as unknown as EntityTable<SyncableObject, 'id'>;
    const local = await table.get(object_id);

    if (local === undefined) { // local doesn't exist
      await this.addPendingOperations('CREATE', 'DEXIE', backup.object_type, [{ object_id: backup.object_id }]);
      try {
        await table.add(content);
      } catch (err: unknown) {
        if (this.isDexieError(err)) {
          this.localRequestErrorHandler(object_id, 'CREATE', err);
          return { error: err };
        }
        throw err;
      }
      return { error: null };
    }

    console.log(`[Supabase] Applying remote ${object_type} ${object_id}`, content);
    await this.addPendingOperations('UPDATE', 'DEXIE', backup.object_type, [{ object_id: backup.object_id }]);
    try {
      await table.put(content);
    } catch (err: unknown) {
      if (this.isDexieError(err)) {
        this.localRequestErrorHandler(object_id, 'UPDATE', err);
        return { error: err };
      }
      throw err;
    }
    return { error: null };
  }

  // remote has been hard deleted
  private async applyRemoteDelete(backup: Partial<Backup>): Promise<{ error: DexieError | null }> {
    const { object_id, object_type } = backup;
    if (object_id === undefined) return { error: null };
    if (object_type === undefined) return { error: null };

    const table = this.dbToSync[object_type as keyof typeof this.dbToSync] as unknown as EntityTable<SyncableObject, 'id'>;

    const local = await table.get(object_id);
    if (local === undefined) return { error: null };

    await this.addPendingOperations('DELETE', 'DEXIE', object_type, [{ object_id }]);
    console.log(`[Supabase] Deleting remote ${object_type} ${object_id}`);
    try {
      await table.delete(object_id);
    } catch (err: unknown) {
      if (this.isDexieError(err)) {
        this.localRequestErrorHandler(object_id, 'DELETE', err);
        return { error: err };
      }
      throw err;
    }
    return { error: null };
  }

  //endregion

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
    this.collectionBackupCache = new Map();
    this.userId = null;
    this.lastPull = new Date(this.defaultPullDate);
    await this.realtimeListener?.removeExistingChannel();
  }

  //endregion

  //region Error handlers
  private remoteRequestErrorHandler(key: string, operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'GET', error: PostgrestError): void {
    console.log(`[Supabase] Remote ${operation} on ${key} failed: ${error.message}`, error);
  }

  private localRequestErrorHandler(key: string, operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'GET', error: DexieError): void {
    console.log(`[Dexie] Local ${operation} on ${key} failed: ${error.message}`, error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isDexieError(err: any): err is DexieError {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call
    return err != null && typeof err === 'object' && typeof err.name === 'string' && err.name.startsWith('Dexie');
  }
  //endregion

  // log time between now and SyncPendinOperations that have been completed
  private LogTime(operations: SyncPendingOperation[]) {
    const now = performance.now();
    let res = ""
    const durationArray: number[] = [];
    for (const operation of operations) {
      const duration = now - operation.date.getTime()
      durationArray.push(duration)
      res += `Operation ${operation.type} to ${operation.location} done in ${duration}ms\n`;
    }
    console.log(res + `Operations duration results:
    - Average: ${durationArray.reduce((a, b) => a + b) / durationArray.length}
    - Max: ${durationArray.reduce((a, b) => a > b ? a : b)}ms
    - Min: ${durationArray.reduce((a, b) => a < b ? a : b)}ms`)
  }

  public getState(): ListenerState {
    const state = this.realtimeListener?.getState();
    if (state == undefined) return ListenerState.DISCONNECTED;
    return state;
  }

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
    SyncManager.instance = null;
  }
}
