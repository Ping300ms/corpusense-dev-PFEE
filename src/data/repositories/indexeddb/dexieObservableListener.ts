import {
  ICreateChange,
  IDeleteChange,
  IUpdateChange,
} from 'dexie-observable/api';
import { db } from '@/data/repositories/indexeddb/db.ts';
import { SyncableObject, SyncableTables } from '@/data/models/Syncable.ts';

export interface OnLocalChangeCallbacks {
  onAdd?: (entity: SyncableObject, table: string) => void | Promise<void>;
  onUpdate?: (entity: SyncableObject, table: string) => void | Promise<void>;
  onDelete?: (key: string, table: string) => void | Promise<void>;
}

export class DexieObservableListener {
  private callbacks: OnLocalChangeCallbacks;

  constructor(callbacks: OnLocalChangeCallbacks) {
    this.callbacks = callbacks;

    db.on('changes', (changes) => {
      for (const change of changes) {
        if (!SyncableTables.includes(change.table)) continue;

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
    void this.callbacks.onAdd?.(change.obj as SyncableObject, change.table);
  }

  private onUpdate(change: IUpdateChange): void {
    void this.callbacks.onUpdate?.(change.obj as SyncableObject, change.table);
  }

  private onDelete(change: IDeleteChange): void {
    void this.callbacks.onDelete?.(change.key as string, change.table);
  }
}
