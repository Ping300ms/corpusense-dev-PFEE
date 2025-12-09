import {
  ICreateChange,
  IDatabaseChange,
  IDeleteChange,
  IUpdateChange,
} from 'dexie-observable/api';
import { SyncableObject, SyncableObjectNames, SyncableTables } from '@/data/models/Syncable.ts';
import Dexie from 'dexie';

export interface OnLocalChangeCallbacks {
  onChange?: (changes: IDatabaseChange[]) => void | Promise<void>;

  // Global grouped callbacks
  onAnnotationChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  onCollectionDetailsChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  onCollectionContentChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;
  onDataModelChanges?: (changes: IDatabaseChange[]) => void | Promise<void>;

  // Grouped callbacks by type
  onInsert?: (changes: ICreateChange[]) => void | Promise<void>;
  onUpdate?: (changes: IUpdateChange[]) => void | Promise<void>;
  onDelete?: (changes: IDeleteChange[]) => void | Promise<void>;

  // Item-by-item callbacks
  onInsertItem?: (entity: SyncableObject, table: SyncableObjectNames) => void | Promise<void>;
  onUpdateItem?: (
    newObject: SyncableObject,
    oldObject: SyncableObject,
    table: SyncableObjectNames
  ) => void | Promise<void>;
  onDeleteItem?: (key: string, table: SyncableObjectNames) => void | Promise<void>;
}

export class DexieObservableListener {
  private callbacks: OnLocalChangeCallbacks;

  constructor(db: Dexie, callbacks: OnLocalChangeCallbacks) {
    this.callbacks = callbacks;

    db.on('changes', (changes) => {
      void callbacks.onChange?.(changes);

      const inserts: ICreateChange[] = [];
      const updates: IUpdateChange[] = [];
      const deletes: IDeleteChange[] = [];
      const changeByTable: Map<string, IDatabaseChange[]> = new Map();

      for (const change of changes) {
        if (!(SyncableTables as string[]).includes(change.table)) continue;
        if (!changeByTable.has(change.table)) changeByTable.set(change.table, [change]);
        else changeByTable.get(change.table)!.push(change);

        switch (change.type as number) {
          case 1:
            inserts.push(change as ICreateChange);
            break;
          case 2:
            updates.push(change as IUpdateChange);
            break;
          case 3:
            deletes.push(change as IDeleteChange);
            break;
        }
      }

      void this.callbacks.onInsert?.(inserts);
      void this.callbacks.onUpdate?.(updates);
      void this.callbacks.onDelete?.(deletes);

      if (this.callbacks.onInsertItem)
        void this.onInsertItem(inserts)
      if (this.callbacks.onUpdateItem)
        void this.onUpdateItem(updates);
      if (this.callbacks.onDeleteItem)
        void this.onDeleteItem(deletes);

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

  private async onInsertItem(changes: ICreateChange[]): Promise<void> {
    changes = changes.sort(
      (a, b) =>
        (a.table === "collections" ? 0 : 1) - (b.table === "collections" ? 0 : 1)
    )
    for (const change of changes) {
      if (change.table === "collections") {
        await this.callbacks.onInsertItem!(
          change.obj as SyncableObject,
          change.table as SyncableObjectNames
        );
        continue;
      }
      void this.callbacks.onInsertItem!(
        change.obj as SyncableObject,
        change.table as SyncableObjectNames
      );
    }
  }

  private async onUpdateItem(changes: IUpdateChange[]): Promise<void> {
    changes = changes.sort(
      (a, b) =>
        (a.table === "collections" ? 0 : 1) - (b.table === "collections" ? 0 : 1)
    )
    for (const change of changes) {
      if (change.table === "collections") {
        await this.callbacks.onUpdateItem!(
          change.obj as SyncableObject,
          change.oldObj as SyncableObject,
          change.table as SyncableObjectNames
        );
        continue;
      }
      void this.callbacks.onUpdateItem!(
        change.obj as SyncableObject,
        change.oldObj as SyncableObject,
        change.table as SyncableObjectNames,
      );
    }
  }

  private onDeleteItem(changes: IDeleteChange[]): void {
    for (const change of changes) {
      // order don't matter, no race conditions
      void this.callbacks.onDeleteItem!(
        change.key as string,
        change.table as SyncableObjectNames,
      );
    }
  }
}
