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
      if (type === "collections") this.collectionBackupCache.set(v.object_id, v);
      res.set(v.object_id, v);
    })
    return { data: res, error: null };
  }

  private async getPartOf(object: SyncableObject, type: 'annotations' | 'collectionContents'): Promise<string | null> {
    const collectionId: string = type === 'annotations' ?
      (object as Annotation).collectionId :
      (object as CollectionContent).id
    let collection = this.collectionBackupCache.get(collectionId);
    if (collection == undefined) {
      const res = await this.read(collectionId, 'collections');
      if (res == null) {
        console.error("No collection found for id " + collectionId);
        return null;
      }
      if (res.error != null) {
        this.remoteRequestErrorHandler([collectionId], 'GET', res?.error);
        return null;
      }
      collection = res.data;
    }
    return collection.id!!;
  }

  // op is only useful in replay mode and must be corresponding to objects list order
  public async create(objects: SyncableObject[], type: SyncableObjectName, op?: SyncPendingOperation[]): Promise<void> {
    if (op == undefined)
      op = await this.addPendingOperations(
        'CREATE',
        'SUPABASE',
        type,
        objects.map(o => { return { object_id: o.id }})
      );

    const userId = await this.getUser();
    if (userId == null) return;

    const toInsert: Backup[] = [];

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      const operation: SyncPendingOperation = op[i];

      let part_of: string | null = null;
      if (type === 'annotations' || type === 'collectionContents') {
        part_of = await this.getPartOf(object, type);
        // If something went wrong cancel operation
        if (part_of == null) return;
      }

      toInsert.push({
        id: uuid(),
        change_id: operation.id,
        content: object,
        deleted_at: null,
        object_id: object.id,
        object_type: type,
        owner_id: userId,
        part_of,
        updated_at: operation.date.toISOString(),

      })
    }

    const { error } = await this.client.from(this.backupTableName).insert<Backup>(toInsert);

    if (error?.code === '23505')
      await this.removePendingOperations(op);
    else if (error !== null)
      this.remoteRequestErrorHandler(objects.map(o => o.id), 'CREATE', error);
    else if (type === 'collections')
      toInsert.forEach(b => this.collectionBackupCache.set(b.object_id, b));
  }

  public async delete(objects_id: string[], type: SyncableObjectName, op?: SyncPendingOperation[]): Promise<void> {
    if (op == undefined)
      op = await this.addPendingOperations(
        'DELETE',
        'SUPABASE',
        type,
        objects_id.map(o => { return { object_id: o }})
      );

    const userId = await this.getUser();
    if (userId == null) return;

    const res = await this.readMultiple(objects_id, type);
    if (res.error != null) {
      this.remoteRequestErrorHandler(objects_id, 'GET', res.error);
      return;
    }

    const toUpsert: Backup[] = [];
    for (let i = 0; i < objects_id.length; i++) {
      const remote = res.data.get(objects_id[i]);
      const operation: SyncPendingOperation = op[i];
      const operationDate = operation.date.toISOString();

      // if no remote, it has been already deleted or never synced
      if (remote != undefined) {
        toUpsert.push({
          ...remote,
          deleted_at: operationDate,
          updated_at: operationDate,
          change_id: operation.id
        });
      }
    }

    const { error } = await this.client
      .from(this.backupTableName)
      .upsert(toUpsert);

    if (error !== null)
      this.remoteRequestErrorHandler(objects_id, 'DELETE', error);
    else if (type === 'collections')
      toUpsert.forEach(b => this.collectionBackupCache.delete(b.object_id));
  }

  public async push(
    changes: {newObj: SyncableObject, oldObj: SyncableObject }[],
    type: SyncableObjectName,
    op?: SyncPendingOperation[]
  ): Promise<void> {
    if (op == undefined)
      op = await this.addPendingOperations(
        'UPDATE',
        'SUPABASE',
        type,
        changes.map(o => {
          return { object_id: o.newObj.id, old: o.oldObj }
        })
      );
    
    const userId = await this.getUser();
    if (userId == null) return;

    const objects_id = changes.map(c => c.newObj.id)
    const remotes = await this.readMultiple(
      objects_id,
      type
    );
    if (remotes.error != null)
      return this.remoteRequestErrorHandler(
        objects_id,
        'GET',
        remotes.error
      )

    const toPush: Backup[] = [];
    const toCreate: SyncableObject[] = [];
    const operationToDelete: SyncPendingOperation[] = [];
    const mergedToSaveInLocal: SyncableObject[] = [];
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const operation: SyncPendingOperation = op[i];
      const remote = remotes.data.get(change.newObj.id);

      if (remote == undefined) { // insert
        operationToDelete.push(operation);
        toCreate.push(change.newObj);
        continue;
      }

      const merged = merge(change, remote, operation);

      // Save merge to local
      if (!isEqual(change.newObj, merged)) {
        mergedToSaveInLocal.push(merged);
        // TODO if CollectionContent update CollectionDetails.contentSize
        // TODO if Annotation and order change update all Annotations order
      }

      toPush.push(
        {
          owner_id: remote.owner_id,
          object_id: remote.object_id,
          object_type: remote.object_type,
          content: merged,
          updated_at: operation.date.toISOString(),
          change_id: operation.id,
          deleted_at: remote.deleted_at,
          part_of: remote.part_of,
        },
      );
    }

    await this.removePendingOperations(operationToDelete);
    await this.create(toCreate, type);

    const { error } = await this.client.from(this.backupTableName).upsert<Backup>(toPush);

    if (error != null)
      this.remoteRequestErrorHandler(objects_id, 'UPDATE', error);
    else {
      const table = this.dbToSync[type as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
      table.bulkPut(mergedToSaveInLocal);
    }
  }
  //endregion

  //region Synchronization
  public async replayPendingOperations(): Promise<void> {
    console.log("Replay pending operations");
    const start = performance.now();
    let operationsCount = 0;

    const operationsMap = new Map<
      SyncableObjectName,
      { insert: SyncPendingOperation[], update: SyncPendingOperation[], delete: SyncPendingOperation[] }
    >();

    await this.operationDb.pendingOperations
      .orderBy('date')
      .each( op => {
          if (op.location !== 'SUPABASE') return;
          operationsCount++;
          const operations = operationsMap.get(op.table)
          if (operations == undefined)
            operationsMap.set(op.table, {
              insert: op.type === "CREATE" ? [op] : [],
              update: op.type === "UPDATE" ? [op] : [],
              delete: op.type === "DELETE" ? [op] : []
            });
          else {
            switch (op.type) {
              case "CREATE":
                operations.insert.push(op);
                break;
              case "UPDATE":
                operations.update.push(op);
                break;
              case "DELETE":
                operations.delete.push(op);
                break;
            }
          }
        }
      );

    for (const table in SyncableTables) {
      const operations = operationsMap.get(table as SyncableObjectName);
      if (operations == undefined) continue;

      if (operations.insert.length > 0) {
        operationsCount += operations.insert.length;
        const {objects, validOperations} = await this.chekValidOperations(operations.insert, table as SyncableObjectName);
        await this.create(objects, table as SyncableObjectName, validOperations);
      }

      if (operations.update.length > 0) {
        operationsCount += operations.update.length;
        const {objects, validOperations} = await this.chekValidOperations(operations.update, table as SyncableObjectName);
        await this.push(operations.update.map((op, i) => {
          if (op.old == null) throw Error("Old version missing");
          return {newObj: objects[i], oldObj: op.old}
        }), table as SyncableObjectName, validOperations);
      }

      if (operations.delete.length > 0) {
        operationsCount += operations.delete.length;
        const operationsId: string[] = operations.delete.map(op => op.id);
        const remotes = await this.readMultiple(operationsId, table as SyncableObjectName);

        if (remotes.error) return this.remoteRequestErrorHandler(operationsId, "GET", remotes.error);

        const validOperations: SyncPendingOperation[] = []
        const idsToDelete: string[] = [];
        const operationsIdToRemove: string[] = [];

        for (const operation of operations.delete) {
          const backup = remotes.data.get(operation.object_id);
          if (backup == undefined) operationsIdToRemove.push(operation.id)
          else {
            validOperations.push(operation);
            idsToDelete.push(operation.object_id);
          }
        }

        void this.operationDb.pendingOperations.bulkDelete(operationsIdToRemove);
        await this.delete(idsToDelete, table as SyncableObjectName, validOperations);
      }
    }

    console.log(`[SyncManager] Replaying operations finished in ${performance.now() - start}ms for ${operationsCount} operations`);
  }

  private async chekValidOperations(
    operations: SyncPendingOperation[],
    type: SyncableObjectName
  ): Promise<{objects: SyncableObject[], validOperations: SyncPendingOperation[]}> {
    const table = this.dbToSync[type as keyof typeof this.dbToSync] as EntityTable<SyncableObject, 'id'>;
    const operationsIdToDelete: string[] = [];
    const objects: SyncableObject[] = []
    const validOperations: SyncPendingOperation[] = []

    const locals = await table.bulkGet(operations.map(op => op.object_id));

    for (let i = 0; i < locals.length; i++) {
      const local = locals[i];
      const operation = operations[i];

      if (local == undefined) operationsIdToDelete.push(operation.id);
      else {
        objects.push(local);
        validOperations.push(operation);
      }
    }

    void this.operationDb.pendingOperations.bulkDelete(operationsIdToDelete);
    return { objects, validOperations };
  }

  public async pullUpdates(): Promise<{ error: string } | null> {
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
        this.remoteRequestErrorHandler([], 'GET', error);
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
      const pendingUpdates = await this.getPendingOperations('UPDATE', 'SUPABASE', table, locals.filter(l => l !== undefined).map(l => l.id))

      const toCreate: SyncableObject[] = [];
      const toUpdate: SyncableObject[] = [];
      const toDelete: string[] = [];
      const syncOperations: SyncPendingOperation[] = [];

      for (let i = 0; i < remotes.length; i++) {
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
    table: SyncableObjectName,
    objects_id: string[],
  ): Promise<Map<string, SyncPendingOperation>> {
    const res: Map<string, SyncPendingOperation> = new Map();
    await this.operationDb.pendingOperations.filter(
      (op) =>
        op.type === type &&
        op.location === target &&
        op.table === table &&
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
    for (const type of SyncableTables) {
      const objectsMap = changes.get(type);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'CREATE', type)

      const objects: SyncableObject[] = []
      objectsMap.forEach(v => objects.push(v.obj as SyncableObject))
      await this.create(objects, type)
    }
  }

  private async onLocalUpdate(changes: Map<SyncableObjectName, Map<string, IUpdateChange>>) {
    for (const table of SyncableTables) {
      const objectsMap = changes.get(table);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'UPDATE', table)

      const objects: { newObj: SyncableObject, oldObj: SyncableObject }[] = []
      objectsMap.forEach(v => objects.push({ newObj: v.obj as SyncableObject, oldObj: v.oldObj as SyncableObject }))
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
    if (error) this.localRequestErrorHandler([payload.new.object_id], 'CREATE', error);
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
    if (error) this.localRequestErrorHandler([payload.new.object_id], 'UPDATE', error);
    else localStorage.setItem(`${this.userId}-lastPull`, payload.new.updated_at);
  }

  private async onRemoteDelete(payload: RealtimePostgresDeletePayload<Backup>): Promise<void> {
    if (payload.old == null) return;
    console.log(`[Supabase] Delete ${payload.old.object_type} → delete in dexie`);
    const { error } = await this.applyRemoteDelete(payload.old);
    if (error && payload.old.object_id != null) this.localRequestErrorHandler([payload.old.object_id], 'DELETE', error);
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
          this.localRequestErrorHandler([object_id], 'CREATE', err);
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
        this.localRequestErrorHandler([object_id], 'UPDATE', err);
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
        this.localRequestErrorHandler([object_id], 'DELETE', err);
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
  private remoteRequestErrorHandler(key: string[], operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'GET', error: PostgrestError): void {
    console.log(`[Supabase] Remote ${operation} on ${key.toString()} failed: ${error.message}`, error);
  }

  private localRequestErrorHandler(key: string[], operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'GET', error: DexieError): void {
    console.log(`[Dexie] Local ${operation} on ${key.toString()} failed: ${error.message}`, error);
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
      if (this.userId == null) console.warn("User not logged in");
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
