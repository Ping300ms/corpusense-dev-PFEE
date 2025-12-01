import {
  ICreateChange,
  IDatabaseChange,
  IDeleteChange,
  IUpdateChange,
} from 'dexie-observable/api';
import { SyncableObjectName, SyncableTables } from '@/data/models/Syncable.ts';
import Dexie from 'dexie';

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

// TODO make it singleton
export class DexieObservableListener {
  private callbacks: OnLocalChangeCallbacks;

  constructor(db: Dexie, callbacks: OnLocalChangeCallbacks) {
    this.callbacks = callbacks;

    db.on('changes', (changes) => {
      void callbacks.onChange?.(changes);

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

      void this.callbacks.onInsert?.(inserts);
      void this.callbacks.onUpdate?.(updates);
      void this.callbacks.onDelete?.(deletes);

      if (this.callbacks.onAnnotationChanges !== undefined) {
        const annotationsChanges = changeByTable.get("annotations");
        if (annotationsChanges !== undefined)
          void this.callbacks.onAnnotationChanges(annotationsChanges);
      }
      if (this.callbacks.onCollectionDetailsChanges !== undefined) {
        const collectionsDetailsChanges = changeByTable.get("collections");
        if (collectionsDetailsChanges !== undefined)
          void this.callbacks.onCollectionDetailsChanges(collectionsDetailsChanges);
      }
      if (this.callbacks.onCollectionContentChanges !== undefined) {
        const collectionContentChanges = changeByTable.get("collectionContents");
        if (collectionContentChanges !== undefined)
          void this.callbacks.onCollectionContentChanges(collectionContentChanges);
      }
      if (this.callbacks.onDataModelChanges !== undefined) {
        const dataModelChanges = changeByTable.get("models");
        if (dataModelChanges !== undefined)
          void this.callbacks.onDataModelChanges(dataModelChanges);
      }
    });
  }
}
