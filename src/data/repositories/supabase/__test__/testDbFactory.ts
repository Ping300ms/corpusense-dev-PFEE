import Dexie, { type EntityTable } from 'dexie';
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import 'dexie-observable';

import { Annotation } from '@/data/models/Annotation';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection';
import { DataModel } from '@/data/models/DataModel';
import { History } from '@/data/models/History';
import { ItemMetadata } from '@/data/models/Metadata';
import { NamedEntity } from '@/data/models/NamedEntity';
import { Result } from '@/data/models/Result';
import { StoredManifestContent, StoredManifestDetails } from '@/data/models/StoredManifest';
import { Tag } from '@/data/models/Tag';
import { Worker } from '@/data/models/Worker';
import { SyncPendingOperation } from '@/data/models/SyncPendingOperation.ts';

/**
 * Fabrique une instance isolée de la base pour les tests
 */
export function createTestDb() {
  const db = new Dexie('mezanno-test', { indexedDB: indexedDB, IDBKeyRange: IDBKeyRange }) as Dexie & {
    collections: EntityTable<CollectionDetails, 'id'>;
    collectionContents: EntityTable<CollectionContent, 'id'>;
    history: EntityTable<History, 'url'>;
    storedManifests: EntityTable<StoredManifestDetails, 'id'>;
    storedManifestContents: EntityTable<StoredManifestContent, 'id'>;
    itemMetadata: EntityTable<ItemMetadata, 'id'>;
    tags: EntityTable<Tag, 'id'>;
    annotations: EntityTable<Annotation, 'id'>;
    models: EntityTable<DataModel, 'id'>;
    namedEntities: EntityTable<NamedEntity, 'id'>;
    results: EntityTable<Result, 'id'>;
    workers: EntityTable<Worker, 'id'>;
  };

  db.version(1).stores({
    collections: '&id, name, *tags.id, synced',
    collectionContents: '&id, synced',
    history: '&url',
    storedManifests: '&id, name',
    storedManifestContents: '&id',
    typesList: '&label',
    itemMetadata: '[id+attribute.label]',
    tags: '&id',
    models: '&id, name, synced',
    annotations: '&id, canvasId, collectionId, [canvasId+collectionId], order, synced',
    namedEntities: '&id, *annotationIds, type.id',
    results: '++id, workerName, workerId, [scopeKey+workerName], taskId',
    workers: '&id, name, status, [scopeKey+name]',
  });

  return db;
}

/**
 * Fabrique la base de synchronisation utilisée pour les opérations différées
 */
export function createTestDbSync() {
  const dbSync = new Dexie('sync-test', { indexedDB: indexedDB, IDBKeyRange: IDBKeyRange }) as Dexie & {
    pendingOperations: EntityTable<SyncPendingOperation, 'id'>;
  };

  dbSync.version(1).stores({
    pendingOperations: '&id, type, location, table, object_id, date',
  });

  return dbSync;
}

/**
 * Supprime toutes les bases de test Dexie
 */
export async function clearTestDatabases() {
  const dbs = await Dexie.getDatabaseNames();
  await Promise.all(dbs.map(name => Dexie.delete(name)));
}
