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

const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 500;

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
  private dexieChangeUnsubscribe?: () => void;
  private authStateListener: Subscription | null = null;
  private onOnlineCallback = () => void this.realtimeListener?.subscribe();
  private onOfflineCallback = () => void this.realtimeListener?.removeExistingChannel();

  //endregion

  public static getInstance(
    client: typeof supabase = supabase,
    dbToSync: typeof db = db,
    operationDb: typeof dbSync = dbSync,
  ): SyncManager {
    if (!SyncManager.instance)
      SyncManager.instance = new SyncManager(client, dbToSync, operationDb);
    return SyncManager.instance;
  }

  private constructor(
    client: SupabaseClient = supabase,
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
    if (!this.dexieChangeUnsubscribe)
      this.dexieChangeUnsubscribe = DexieObservableListener.subscribe({
        onInsert: (changes) => this.onLocalInsert(changes),
        onUpdate: (changes) => this.onLocalUpdate(changes),
        onDelete: (changes) => this.onLocalDelete(changes),
      });

    // Supabase → Dexie
    if (this.realtimeListener == null)
      this.realtimeListener = new SupabaseRealtimeListener({
        tableName: this.backupTableName,
        channelBaseName: this.backupTableName,
        onInsert: (p) => {
          void this.onRemoteInsert(p);
        },
        onUpdate: (p) => {
          void this.onRemoteUpdate(p);
        },
        onDelete: (p) => {
          void this.onRemoteDelete(p);
        },
        onSubscribed: () => {
          void this.InitSync();
        },
        onShared: (p) => {
          void this.onShared(p);
        },
        supabaseClient: this.client,
      } as SupabaseListenerProperties);

    if (this.authStateListener == null)
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

    window.addEventListener('online', this.onOnlineCallback);
    window.addEventListener('offline', this.onOfflineCallback);
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
    if (data.object_type === 'collections') this.collectionBackupCache.set(data.object_id, data);
    return { data, error: null };
  }

  public async readMultiple(
    objects_id: string[],
    type: SyncableObjectName,
  ): Promise<
    | { data: null; error: PostgrestError }
    | { data: Map<string, Backup>; error: null }
  > {
    if (objects_id.length === 0) {
      return { data: new Map(), error: null };
    }

    const result = new Map<string, Backup>();
    const idChunks = this.chunkArray(objects_id, IN_CHUNK_SIZE);

    try {
      for (const ids of idChunks) {
        let from = 0;

        while (true) {
          const to = from + PAGE_SIZE - 1;

          const { data, error } = await this.client
            .from(this.backupTableName)
            .select<'*', Backup>()
            .eq('object_type', type)
            .is('deleted_at', null)
            .in('object_id', ids)
            .range(from, to);

          if (error) {
            return { data: null, error };
          }

          if (!data || data.length === 0) {
            break;
          }

          for (const v of data) {
            if (type === 'collections') {
              this.collectionBackupCache.set(v.object_id, v);
            }
            result.set(v.object_id, v);
          }

          // Dernière page atteinte
          if (data.length < PAGE_SIZE) {
            break;
          }

          from += PAGE_SIZE;
        }
      }

      return { data: result, error: null };
    } catch (e) {
      if (e instanceof PostgrestError) {
        return { data: null, error: e };
      }

      return {
        data: null,
        error: new PostgrestError({
          message: 'unknown error',
          details: '',
          hint: '',
          code: '',
        }),
      };
    }
  }


  private chunkArray<T>(arr: T[], size: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      res.push(arr.slice(i, i + size));
    }
    return res;
  }

  private async getPartOf(
    object: SyncableObject,
    type: 'annotations' | 'collectionContents',
  ): Promise<string | null> {
    const collectionId: string =
      type === 'annotations'
        ? (object as Annotation).collectionId
        : (object as CollectionContent).id;
    let collection = this.collectionBackupCache.get(collectionId);
    if (collection == undefined) {
      const res = await this.read(collectionId, 'collections');
      if (res == null) {
        console.error('No collection found for id ' + collectionId);
        return null;
      }
      if (res.error != null) {
        this.remoteRequestErrorHandler([collectionId], 'GET', res?.error);
        return null;
      }
      collection = res.data;
    }
    return collection.id;
  }

  // op is only useful in replay mode and must be corresponding to objects list order
  public async create(
    objects: SyncableObject[],
    type: SyncableObjectName,
    op?: SyncPendingOperation[],
  ): Promise<void> {
    if (op == undefined)
      op = await this.addPendingOperations(
        'CREATE',
        'SUPABASE',
        type,
        objects.map((o) => {
          return { object_id: o.id };
        }),
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
      });
    }

    const { error } = await this.client.from(this.backupTableName).insert<Backup>(toInsert);

    if (error?.code === '23505') await this.removePendingOperations(op);
    else if (error !== null)
      this.remoteRequestErrorHandler(
        objects.map((o) => o.id),
        'CREATE',
        error,
      );
    else if (type === 'collections')
      toInsert.forEach((b) => this.collectionBackupCache.set(b.object_id, b));
  }

  public async delete(
    objects_id: string[],
    type: SyncableObjectName,
    op?: SyncPendingOperation[],
  ): Promise<void> {
    if (op == undefined)
      op = await this.addPendingOperations(
        'DELETE',
        'SUPABASE',
        type,
        objects_id.map((o) => {
          return { object_id: o };
        }),
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
          change_id: operation.id,
        });
      }
    }

    const { error } = await this.client.from(this.backupTableName).upsert(toUpsert);

    if (error !== null) this.remoteRequestErrorHandler(objects_id, 'DELETE', error);
    else if (type === 'collections')
      toUpsert.forEach((b) => this.collectionBackupCache.delete(b.object_id));
  }

  public async push(
    changes: { newObj: SyncableObject; oldObj: SyncableObject }[],
    type: SyncableObjectName,
    op?: SyncPendingOperation[],
  ): Promise<void> {
    if (op == undefined)
      op = await this.addPendingOperations(
        'UPDATE',
        'SUPABASE',
        type,
        changes.map((o) => {
          return { object_id: o.newObj.id, old: o.oldObj };
        }),
      );

    const userId = await this.getUser();
    if (userId == null) return;

    const objects_id = changes.map((c) => c.newObj.id);
    const remotes = await this.readMultiple(objects_id, type);
    if (remotes.error != null)
      return this.remoteRequestErrorHandler(objects_id, 'GET', remotes.error);

    const toPush: Backup[] = [];
    const toCreate: SyncableObject[] = [];
    const operationToDelete: SyncPendingOperation[] = [];
    const mergedToSaveInLocal: SyncableObject[] = [];
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const operation: SyncPendingOperation = op[i];
      const remote = remotes.data.get(change.newObj.id);

      if (remote == undefined) {
        // insert
        operationToDelete.push(operation);
        toCreate.push(change.newObj);
        continue;
      }

      const merged = merge(change, remote, operation);

      // Save merge to local
      if (!isEqual(change.newObj, merged)) {
        mergedToSaveInLocal.push(merged);
        if (type === 'collectionContents') {
          const contentSize = (merged as CollectionContent).content.length;
          await this.dbToSync.collections.update(merged.id, {
            contentSize,
          });
        }
        // TODO if Annotation order change update all Annotations order
        // How ?
      }

      toPush.push({
        id: remote.id,
        owner_id: remote.owner_id,
        object_id: remote.object_id,
        object_type: remote.object_type,
        content: merged,
        updated_at: operation.date.toISOString(),
        change_id: operation.id,
        deleted_at: remote.deleted_at,
        part_of: remote.part_of,
      });
    }

    if (operationToDelete.length > 1) await this.removePendingOperations(operationToDelete);
    if (operationToDelete.length > 1) await this.create(toCreate, type);

    const { error } = await this.client
      .from(this.backupTableName)
      .upsert<Backup>(toPush, { onConflict: 'owner_id,object_type,object_id' });

    if (error != null) this.remoteRequestErrorHandler(objects_id, 'UPDATE', error);
    else {
      const table = this.dbToSync[type as keyof typeof this.dbToSync] as EntityTable<
        SyncableObject,
        'id'
      >;
      await table.bulkPut(mergedToSaveInLocal);
    }
  }
  //endregion

  //region Synchronization
  public async replayPendingOperations(): Promise<void> {
    console.log('Replay pending operations');
    const start = performance.now();
    let operationsCount = 0;

    const operationsMap = new Map<
      SyncableObjectName,
      {
        insert: SyncPendingOperation[];
        update: SyncPendingOperation[];
        delete: SyncPendingOperation[];
      }
    >();

    await this.operationDb.pendingOperations.orderBy('date').each((op) => {
      if (op.location !== 'SUPABASE') return;
      const operations = operationsMap.get(op.table);
      if (operations == undefined)
        operationsMap.set(op.table, {
          insert: op.type === 'CREATE' ? [op] : [],
          update: op.type === 'UPDATE' ? [op] : [],
          delete: op.type === 'DELETE' ? [op] : [],
        });
      else {
        switch (op.type) {
          case 'CREATE':
            operations.insert.push(op);
            break;
          case 'UPDATE':
            operations.update.push(op);
            break;
          case 'DELETE':
            operations.delete.push(op);
            break;
        }
      }
    });

    // for (const table of SyncableTables) weird behavior, table = 0..3 I don't know why
    for (let i = 0; i < SyncableTables.length; i++) {
      const table = SyncableTables[i];
      const operations = operationsMap.get(table);
      if (operations == undefined) continue;

      const tasks: Promise<void>[] = [];

      if (operations.insert.length > 0) {
        operationsCount += operations.insert.length;
        tasks.push(this.replayInsert(operations.insert, table));
      }

      if (operations.update.length > 0) {
        operationsCount += operations.update.length;
        tasks.push(this.replayUpdate(operations.update, table));
      }

      if (operations.delete.length > 0) {
        operationsCount += operations.delete.length;
        tasks.push(this.replayDelete(operations.delete, table));
      }

      await Promise.all(tasks);
    }

    console.log(
      `[SyncManager] Replaying operations finished in ${(performance.now() - start).toFixed(2)}ms for ${operationsCount} operations`,
    );
  }

  private async replayInsert(insertOperation: SyncPendingOperation[], table: SyncableObjectName) {
    const { objects, validOperations } = await this.chekValidOperations(
      insertOperation,
      table,
    );
    await this.create(objects, table, validOperations);
  }

  private async replayUpdate(updateOperations: SyncPendingOperation[], table: SyncableObjectName): Promise<void> {
    const { objects, validOperations } = await this.chekValidOperations(
      updateOperations,
      table,
    );
    await this.push(
      updateOperations.map((op, index) => {
        if (op.old == null) throw Error('Old version missing');
        return { newObj: objects[index], oldObj: op.old };
      }),
      table,
      validOperations,
    );
  }

  private async replayDelete(deleteOperations: SyncPendingOperation[], table: SyncableObjectName) {
    const operationsId: string[] = deleteOperations.map((op) => op.id);
    const remotes = await this.readMultiple(operationsId, table);

    if (remotes.error) {
      // FIXME weird error 401 on read, maybe due to uuid format
      if (remotes.error.code === "Bad Request")
        await this.operationDb.pendingOperations.bulkDelete(operationsId);
      return this.remoteRequestErrorHandler(operationsId, 'GET', remotes.error);
    }

    const validOperations: SyncPendingOperation[] = [];
    const idsToDelete: string[] = [];
    const operationsIdToRemove: string[] = [];

    for (const operation of deleteOperations) {
      const backup = remotes.data.get(operation.object_id);
      if (backup == undefined) operationsIdToRemove.push(operation.id);
      else {
        validOperations.push(operation);
        idsToDelete.push(operation.object_id);
      }
    }

    await this.delete(idsToDelete, table, validOperations);
    await this.operationDb.pendingOperations.bulkDelete(operationsIdToRemove);
  }

  private async chekValidOperations(
    operations: SyncPendingOperation[],
    type: SyncableObjectName,
  ): Promise<{ objects: SyncableObject[]; validOperations: SyncPendingOperation[] }> {
    const table = this.dbToSync[type as keyof typeof this.dbToSync] as EntityTable<
      SyncableObject,
      'id'
    >;
    const operationsIdToDelete: string[] = [];
    const objects: SyncableObject[] = [];
    const validOperations: SyncPendingOperation[] = [];

    const locals = await table.bulkGet(operations.map((op) => op.object_id));

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

    if (!(await this.getUser())) {
      return { error: `[SELECT] Sync: error not logged in` };
    }

    const requestDate = new Date();
    const since = this.lastPull?.toISOString() ?? this.defaultPullDate;
    let operationCount = 0;

    for (const table of SyncableTables) {
      const { data, error } = await this.fetchRemoteUpdates(table, since);
      if (error) {
        this.remoteRequestErrorHandler([], 'GET', error);
        return {
          error: `[PULL] Sync: error pulling from Supabase ${table} updates ${error.message}`,
        };
      }

      if (!data || data.length === 0) continue;

      const plan = await this.computeSyncPlan(table, data);
      await this.applySyncPlan(table, plan);

      console.log(
        `[⏱️ SyncManager] pull ${table} updates completed (${data.length} changes)`,
      );
      operationCount += data.length;
    }

    localStorage.setItem(`${this.userId}-lastPull`, requestDate.toString());
    this.lastPull = requestDate;

    console.log(
      `[⏱️ SyncManager] pullUpdates completed in ${(performance.now() - start).toFixed(2)}ms for ${operationCount} operations`,
    );

    return null;
  }

  private async fetchRemoteUpdates(
    table: SyncableObjectName,
    since: string,
  ): Promise<
    { data: Pick<Backup, 'object_id' | 'content' | 'deleted_at'>[]; error: null }
    | { data: null; error: PostgrestError }
  > {
    const res: Pick<Backup, 'object_id' | 'content' | 'deleted_at'>[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await this.client
        .from(this.backupTableName)
        .select('object_id, content, updated_at, deleted_at')
        .eq('object_type', table)
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) return { data: null, error };
      if (!data || data.length === 0) break;

      res.push(...data);

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return { data: res, error: null };
  }

  private async computeSyncPlan(
    table: SyncableObjectName,
    remotes: Pick<Backup, 'object_id' | 'content' | 'deleted_at'>[],
  ): Promise<{
    toCreate: SyncableObject[];
    toUpdate: SyncableObject[];
    toDelete: string[];
    operations: SyncPendingOperation[];
  }> {
    const objectIds = remotes.map(r => r.object_id as string);

    const dbTable = this.dbToSync[table] as EntityTable<SyncableObject, 'id'>;
    const locals = await dbTable.bulkGet(objectIds);

    const pendingUpdates = await this.getPendingOperations(
      'UPDATE',
      'SUPABASE',
      table,
      locals.filter(Boolean).map(l => l!.id),
    );

    const toCreate: SyncableObject[] = [];
    const toUpdate: SyncableObject[] = [];
    const toDelete: string[] = [];
    const operations: SyncPendingOperation[] = [];

    for (let i = 0; i < remotes.length; i++) {
      const remote = remotes[i];
      const local = locals[i];

      if (remote.deleted_at) {
        if (!local) continue;

        operations.push({
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
        operations.push({
          id: uuid(),
          type: 'CREATE',
          location: 'DEXIE',
          object_id: remote.object_id as string,
          table,
          date: new Date(),
          old: null,
        });

        toCreate.push(remote.content as SyncableObject);
        continue;
      }

      if (pendingUpdates.has(local.id)) continue; // replay pending will be in charge of the merge

      operations.push({
        id: uuid(),
        type: 'UPDATE',
        location: 'DEXIE',
        object_id: local.id,
        table,
        date: new Date(),
        old: null,
      });

      toUpdate.push(remote.content as SyncableObject);
    }

    return { toCreate, toUpdate, toDelete, operations };
  }

  private async applySyncPlan(
    table: SyncableObjectName,
    plan: Awaited<ReturnType<typeof this.computeSyncPlan>>,
  ): Promise<void> {
    const dbTable = this.dbToSync[table] as EntityTable<SyncableObject, 'id'>;
    const tasks: Promise<any>[] = [];
    tasks.push(this.operationDb.pendingOperations.bulkAdd(plan.operations));
    tasks.push(dbTable.bulkDelete(plan.toDelete));
    tasks.push(dbTable.bulkAdd(plan.toCreate));
    tasks.push(dbTable.bulkPut(plan.toUpdate));

    await Promise.all(tasks);
  }
  //endregion

  //region Share logic
  public async share(
    objectId: string,
    sharedUserMail: string,
    type: 'collections' | 'models',
    permission: 'R' | 'RW' | 'RWD',
  ): Promise<{
    error: string;
  } | null> {
    const user = await this.getUser();
    if (user == null) return { error: `[SHARE] error not logged in` };

    let sharedObject = this.collectionBackupCache.get(objectId);
    if (sharedObject == undefined) {
      const res = await this.read(objectId, type);
      if (res == null) return { error: `[SHARE] object not sync yet` };
      if (res.error) return { error: res.error.message };
      sharedObject = res.data;
    }
    if (sharedObject.owner_id != user) return { error: 'you are not the owner' };

    const { data: shareResult, error: shareError } = (await supabase.rpc('share_backup_to_email', {
      target_email: sharedUserMail,
      target_backup_id: sharedObject.id,
      target_permission: permission,
    })) as { data: { success: boolean; message: string } | null; error: PostgrestError | null };

    if (shareError) {
      // Erreur SQL/RPC
      return { error: shareError.message };
    } else if (shareResult?.success === false) {
      // email inconnu ou autre validation interne
      return { error: shareResult.message };
    }

    return null; // success
  }

  public async onShared(payload: RealtimePostgresInsertPayload<BackupShares>) {
    const { backup_id, shared_user } = payload.new;

    const user = await this.getUser();
    if (user == null) return { error: `[SHARE] error not logged in` };
    if (shared_user !== user) return;
    console.log('A collection has been shared with you !');

    const { data, error } = await this.client
      .from(this.backupTableName)
      .select('content, object_type')
      .or(`id.eq.${backup_id},part_of.eq.${backup_id}`)
      .is('deleted_at', null);
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
        case 'collectionContents':
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
    await this.operationDb.pendingOperations
      .filter(
        (op) =>
          op.type === type &&
          op.location === target &&
          op.table === table &&
          objects_id.includes(op.object_id),
      )
      .each((obj) => res.set(obj.object_id, obj));
    return res;
  }

  private async addPendingOperations(
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    location: 'DEXIE' | 'SUPABASE',
    table: SyncableObjectName,
    objects: { object_id: string; old?: SyncableObject }[],
  ): Promise<SyncPendingOperation[]> {
    const existing = await this.getPendingOperations(
      type,
      location,
      table,
      objects.map((o) => o.object_id),
    );
    const toPut: SyncPendingOperation[] = [];

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
    this.logTime(operations);
  }

  //endregion

  //region Local handler

  private async filterLocalDoneOperations(
    objects: Map<string, IDatabaseChange>,
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    table: SyncableObjectName,
  ) {
    const ids = Array.from(objects.keys());
    const operations = await this.getPendingOperations(type, 'DEXIE', table, ids);
    const toRemove: SyncPendingOperation[] = [];
    for (const id of ids) {
      const operation = operations.get(id);
      if (operation != undefined) {
        toRemove.push(operation);
        objects.delete(id);
      }
    }
    await this.removePendingOperations(toRemove);
  }

  private async onLocalInsert(changes: Map<SyncableObjectName, Map<string, ICreateChange>>) {
    for (const type of SyncableTables) {
      const objectsMap = changes.get(type);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'CREATE', type);

      const objects: SyncableObject[] = [];
      objectsMap.forEach((v) => objects.push(v.obj as SyncableObject));
      await this.create(objects, type);
    }
  }

  private async onLocalUpdate(changes: Map<SyncableObjectName, Map<string, IUpdateChange>>) {
    for (const table of SyncableTables) {
      const objectsMap = changes.get(table);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'UPDATE', table);

      const objects: { newObj: SyncableObject; oldObj: SyncableObject }[] = [];
      objectsMap.forEach((v) =>
        objects.push({ newObj: v.obj as SyncableObject, oldObj: v.oldObj as SyncableObject }),
      );
      await this.push(objects, table);
    }
  }

  private async onLocalDelete(changes: Map<SyncableObjectName, Map<string, IDeleteChange>>) {
    for (const table of SyncableTables) {
      const objectsMap = changes.get(table);
      if (objectsMap == undefined) continue;

      await this.filterLocalDoneOperations(objectsMap, 'DELETE', table);

      await this.delete(Array.from(objectsMap.keys()), table);
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

    const { error } = await this.applyRemoteChange(payload.new);
    if (error) this.localRequestErrorHandler([payload.new.object_id], 'UPDATE', error);
    else localStorage.setItem(`${this.userId}-lastPull`, payload.new.updated_at);
  }

  private async onRemoteDelete(payload: RealtimePostgresDeletePayload<Backup>): Promise<void> {
    if (payload.old == null) return;
    const { error } = await this.applyRemoteDelete(payload.old);
    if (error && payload.old.object_id != null)
      this.localRequestErrorHandler([payload.old.object_id], 'DELETE', error);
  }

  private async applyRemoteChange(backup: Backup): Promise<{ error: DexieError | null }> {
    if (backup.deleted_at != null) {
      // remote has been soft deleted
      return await this.applyRemoteDelete(backup);
    }

    const { object_id, object_type, content } = backup;
    const table = this.dbToSync[
      object_type as keyof typeof this.dbToSync
    ] as unknown as EntityTable<SyncableObject, 'id'>;
    const local = await table.get(object_id);

    if (local === undefined) {
      // local doesn't exist
      await this.addPendingOperations('CREATE', 'DEXIE', backup.object_type, [
        { object_id: backup.object_id },
      ]);
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
    await this.addPendingOperations('UPDATE', 'DEXIE', backup.object_type, [
      { object_id: backup.object_id },
    ]);
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

    const table = this.dbToSync[
      object_type as keyof typeof this.dbToSync
    ] as unknown as EntityTable<SyncableObject, 'id'>;

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

  private async onSignedIn() {
    // purge DEXIE operations at start
    await this.operationDb.pendingOperations.where('location').equals('DEXIE').delete();
    await this.realtimeListener?.subscribe();
    const userId = await this.getUser();
    if (userId == null) return; // not supposed to happen (but happens sometimes... race condition)
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
  private remoteRequestErrorHandler(
    key: string[],
    operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'GET',
    error: PostgrestError,
  ): void {
    console.log(`[Supabase] Remote ${operation} failed: ${error.message}`, error, key);
  }

  private localRequestErrorHandler(
    key: string[],
    operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'GET',
    error: DexieError,
  ): void {
    console.log(`[Dexie] Local ${operation} on ${key.toString()} failed: ${error.message}`, error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isDexieError(err: any): err is DexieError {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      err != null &&
      typeof err === 'object' &&
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      typeof err.name === 'string' &&
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      err.name.startsWith('Dexie')
    );
  }
  //endregion

  // log time between now and SyncPendinOperations that have been completed
  private logTime(operations: SyncPendingOperation[]) {
    if (operations.length === 0) return;
    const now = new Date();
    const durationArray: number[] = [];
    for (const operation of operations) {
      const duration = now.getTime() - operation.date.getTime();
      durationArray.push(duration);
    }
    if (operations.length < 2) {
      const operation = operations[0];
      console.log(
        `Operations ${operation.type} on ${operation.table} duration results: ${now.getTime() - operation.date.getTime()}ms`,
      );
      return;
    }
    console.log(`${operations[0].table} ${operations[0].type} on ${operations[0].location} duration results:
    - Average: ${durationArray.reduce((a, b) => a + b) / durationArray.length}
    - Max: ${durationArray.reduce((a, b) => (a > b ? a : b))}ms
    - Min: ${durationArray.reduce((a, b) => (a < b ? a : b))}ms`);
  }

  public getState(): ListenerState {
    const state = this.realtimeListener?.getState();
    if (state == undefined) return ListenerState.DISCONNECTED;
    return state;
  }

  private async getUser(): Promise<string | null> {
    if (this.userId == null) this.userId = (await this.client.auth.getUser()).data.user?.id ?? null;
    // if (this.userId == null) console.debug('User not logged in');
    return this.userId;
  }

  public async destroy(): Promise<void> {
    this.dexieChangeUnsubscribe?.();
    await this.realtimeListener?.removeExistingChannel();
    this.realtimeListener = null;
    this.authStateListener?.unsubscribe();
    this.authStateListener = null;
    window.removeEventListener('online', this.onOnlineCallback);
    window.removeEventListener('offline', this.onOfflineCallback);
    SyncManager.instance = null;
  }
}
