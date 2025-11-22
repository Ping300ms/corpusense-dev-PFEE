import {
  ICreateChange, IDatabaseChange,
  IDeleteChange,
  IUpdateChange,
} from 'dexie-observable/api';
import { SyncableObject, SyncableObjectNames, SyncableTables } from '@/data/models/Syncable.ts';
import Dexie from 'dexie';

export interface OnLocalChangeCallbacks {
  onChange?: (changes: IDatabaseChange[]) => void |Promise<void>;
  onAdd?: (entity: SyncableObject, table: SyncableObjectNames) => void | Promise<void>;
  onUpdate?: (newObject: SyncableObject, oldObject: SyncableObject, table: SyncableObjectNames) => void | Promise<void>;
  onDelete?: (key: string, table: SyncableObjectNames) => void | Promise<void>;
}

export class DexieObservableListener {
  private callbacks: OnLocalChangeCallbacks;

  constructor(db: Dexie, callbacks: OnLocalChangeCallbacks) {
    this.callbacks = callbacks;

    db.on('changes', (changes) => {
      void callbacks.onChange?.(changes);

      // TODO sort changes type, sort in each type by table, define more callbacks type and make callbacks take lists
      for (const change of changes) {
        if (!(SyncableTables as string[]).includes(change.table)) continue;

        switch (change.type as number) {
          case 1: // CREATE
            this.onCreate(change as ICreateChange);
            break;
          case 2: { // UPDATE
            this.onUpdate(change as IUpdateChange);
            break;
          }
          case 3: { // DELETE
            this.onDelete(change as IDeleteChange);
            break;
          }
        }
      }
    });
  }

  private onCreate(change: ICreateChange): void {
    void this.callbacks.onAdd?.(change.obj as SyncableObject, change.table as SyncableObjectNames);
  }

  private onUpdate(change: IUpdateChange): void {
    void this.callbacks.onUpdate?.(change.obj as SyncableObject, change.oldObj as SyncableObject, change.table as SyncableObjectNames);
  }

  private onDelete(change: IDeleteChange): void {
    void this.callbacks.onDelete?.(change.key as string, change.table as SyncableObjectNames);
  }
}
