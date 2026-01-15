import {
  ICreateChange,
  IDatabaseChange,
  IDeleteChange,
  IUpdateChange,
} from 'dexie-observable/api';
import { SyncableObjectName, SyncableTables } from '@/data/models/Syncable.ts';
import Dexie from 'dexie';
import { v4 as uuid } from 'uuid';
import { db } from '@/data/repositories/indexeddb/db.ts';

export interface OnLocalChangeCallbacks {
  onChange?: (changes: IDatabaseChange[]) => void | Promise<void>;

  // Grouped callbacks by table
  onAnnotationChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  onCollectionDetailsChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  onCollectionContentChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  onDataModelChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;

  // Grouped callbacks by type
  onInsert?: (changes: Map<SyncableObjectName, Map<string, ICreateChange>>) => void | Promise<void>;
  onUpdate?: (changes: Map<SyncableObjectName, Map<string, IUpdateChange>>) => void | Promise<void>;
  onDelete?: (changes: Map<SyncableObjectName, Map<string, IDeleteChange>>) => void | Promise<void>;
}

export class DexieObservableListener {
  private static instance: DexieObservableListener = new DexieObservableListener(db);

  private subscribers: Map<string, OnLocalChangeCallbacks> = new Map();

  /*
  params:
    - callbacks: object containing all callbacks to subscribe
  returns:
    - unsubscribe function
   */
  public static subscribe(callback: OnLocalChangeCallbacks): () => void {
    const id = uuid();
    this.instance.subscribers.set(id, callback);
    return () => this.instance.subscribers.delete(id);
  }

  private constructor(dbToListen: Dexie) {
    dbToListen.on('changes', (changes) => {
      for (const callbacksObj of this.subscribers.values())
        void callbacksObj.onChange?.(changes);

      const inserts: Map<SyncableObjectName, Map<string, ICreateChange>> = new Map();
      const updates: Map<SyncableObjectName, Map<string, IUpdateChange>> = new Map();
      const deletes: Map<SyncableObjectName, Map<string, IDeleteChange>> = new Map();
      const changeByTable: Map<SyncableObjectName, IDatabaseChange[]> = new Map();

      for (const change of changes) {
        if (!(SyncableTables as string[]).includes(change.table)) continue;
        const table = change.table as SyncableObjectName;
        if (!changeByTable.has(table)) {
          changeByTable.set(table, [change]);
          inserts.set(table, new Map<string, ICreateChange>());
          updates.set(table, new Map<string, IUpdateChange>());
          deletes.set(table, new Map<string, IDeleteChange>());
        }
        else changeByTable.get(table)!.push(change);

        switch (change.type as number) {
          case 1:
            inserts.get(table)!.set(change.key as string, change as ICreateChange);
            break;
          case 2:
            updates.get(table)!.set(change.key as string, change as IUpdateChange);
            break;
          case 3:
            deletes.get(table)!.set(change.key as string, change as IDeleteChange);
            break;
        }
      }

      for (const callbacksObj of this.subscribers.values()) void callbacksObj.onInsert?.(inserts);
      for (const callbacksObj of this.subscribers.values()) void callbacksObj.onUpdate?.(updates);
      for (const callbacksObj of this.subscribers.values()) void callbacksObj.onDelete?.(deletes);

      const collectionsDetailsChanges = changeByTable.get("collections");
      if (collectionsDetailsChanges !== undefined)
        for (const callbacksObj of this.subscribers.values())
          void callbacksObj.onCollectionDetailsChanges?.(collectionsDetailsChanges);

      const collectionContentChanges = changeByTable.get("collectionContents");
      if (collectionContentChanges !== undefined)
        for (const callbacksObj of this.subscribers.values())
          void callbacksObj.onCollectionContentChanges?.(collectionContentChanges);

      const annotationsChanges = changeByTable.get("annotations");
      if (annotationsChanges !== undefined)
        for (const callbacksObj of this.subscribers.values())
          void callbacksObj.onAnnotationChanges?.(annotationsChanges);

      const dataModelChanges = changeByTable.get("models");
      if (dataModelChanges !== undefined)
        for (const callbacksObj of this.subscribers.values())
          void callbacksObj.onDataModelChanges?.(dataModelChanges);
    });
  }
}
