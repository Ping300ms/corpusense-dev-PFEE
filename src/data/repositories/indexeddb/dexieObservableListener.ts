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

/**
 * Interface defining the available hook callbacks for database changes.
 * Subscribers can listen to raw changes, specific tables, or specific operation types.
 */
export interface OnLocalChangeCallbacks {
  /** Triggered for every raw change detected in the database. */
  onChange?: (changes: IDatabaseChange[]) => void | Promise<void>;

  // --- Grouped callbacks by table ---
  /** Triggered when changes occur in the 'annotations' table. */
  onAnnotationChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  /** Triggered when changes occur in the 'collections' table. */
  onCollectionDetailsChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  /** Triggered when changes occur in the 'collectionContents' table. */
  onCollectionContentChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  /** Triggered when changes occur in the 'models' table. */
  onDataModelChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;

  // --- Grouped callbacks by type ---
  /** Triggered for all INSERT operations, mapped by table name and primary key. */
  onInsert?: (changes: Map<SyncableObjectName, Map<string, ICreateChange>>) => void | Promise<void>;
  /** Triggered for all UPDATE operations, mapped by table name and primary key. */
  onUpdate?: (changes: Map<SyncableObjectName, Map<string, IUpdateChange>>) => void | Promise<void>;
  /** Triggered for all DELETE operations, mapped by table name and primary key. */
  onDelete?: (changes: Map<SyncableObjectName, Map<string, IDeleteChange>>) => void | Promise<void>;
}

/**
 * A Singleton service that listens to Dexie.js database changes and dispatches them
 * to registered subscribers. It categorizes changes to make local synchronization easier.
 */
export class DexieObservableListener {
  /** The single shared instance of the listener. */
  private static instance: DexieObservableListener = new DexieObservableListener(db);

  /** Active subscribers identified by a unique UUID. */
  private subscribers: Map<string, OnLocalChangeCallbacks> = new Map();

  /**
   * Subscribes a set of callbacks to database changes.
   * * @param callback - An object containing one or more callback functions.
   * @returns A cleanup function to unsubscribe and prevent memory leaks.
   * * @example
   * const unsubscribe = DexieObservableListener.subscribe({
   * onInsert: (inserts) => console.log("New items:", inserts)
   * });
   */
  public static subscribe(callback: OnLocalChangeCallbacks): () => void {
    const id = uuid();
    this.instance.subscribers.set(id, callback);
    return () => this.instance.subscribers.delete(id);
  }

  /**
   * Private constructor to initialize the Dexie 'changes' event listener.
   * Filters and sorts incoming changes into categorized Maps before dispatching to subscribers.
   * * @param dbToListen - The Dexie database instance to observe.
   */
  private constructor(dbToListen: Dexie) {
    dbToListen.on('changes', (changes) => {
      // 1. Notify raw change subscribers
      for (const callbacksObj of this.subscribers.values())
        void callbacksObj.onChange?.(changes);

      // Data structures to categorize changes
      const inserts: Map<SyncableObjectName, Map<string, ICreateChange>> = new Map();
      const updates: Map<SyncableObjectName, Map<string, IUpdateChange>> = new Map();
      const deletes: Map<SyncableObjectName, Map<string, IDeleteChange>> = new Map();
      const changeByTable: Map<SyncableObjectName, IDatabaseChange[]> = new Map();

      // 2. Process and categorize each change
      for (const change of changes) {
        // Only track tables defined in SyncableTables
        if (!(SyncableTables as string[]).includes(change.table)) continue;

        const table = change.table as SyncableObjectName;

        // Initialize maps for the table if not present
        if (!changeByTable.has(table)) {
          changeByTable.set(table, [change]);
          inserts.set(table, new Map<string, ICreateChange>());
          updates.set(table, new Map<string, IUpdateChange>());
          deletes.set(table, new Map<string, IDeleteChange>());
        }
        else changeByTable.get(table)!.push(change);

        // Categorize by operation type (1: Create, 2: Update, 3: Delete)
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

      // 3. Dispatch Grouped Callbacks (By Type)
      for (const callbacksObj of this.subscribers.values()) void callbacksObj.onInsert?.(inserts);
      for (const callbacksObj of this.subscribers.values()) void callbacksObj.onUpdate?.(updates);
      for (const callbacksObj of this.subscribers.values()) void callbacksObj.onDelete?.(deletes);

      // 4. Dispatch Table-Specific Callbacks
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
