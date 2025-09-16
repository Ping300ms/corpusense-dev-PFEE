import { createClient, SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { Syncable } from '@/data/models/Syncable.ts';
import { db } from '@/data/repositories/indexeddb/db.ts';
import Dexie from 'dexie';

export class SyncManager {
  private readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    );
  }

  public async sync<T extends Syncable>(obj : T, type : keyof typeof db): Promise<SyncResult<T>> {
    const local : Backup<T> = {
      id: null,
      user_id: "29ec51b9-405e-410e-9188-99f40ca7ff46", // TODO
      object_id: obj.id,
      object_type: type,
      content: obj,
      updated_at: obj.updated_at
    }

    const ref = (await this.client.from('backup')
                                              .select('*')
                                              .eq('id', obj.id)
                                              .single<Backup<T>>()
      ).data;

    let merged : Backup<T>;
    // merge conflict strategy
    if (ref != null) {
      // temporary latest wins
      merged = ref.updated_at < local.updated_at ? local : ref;

      // TODO CRDT du json
    } else {
      merged = local;
    }

    const res = await this.client.from('backup').upsert<Backup<T>>(merged, {
      onConflict: 'user_id,object_type,object_id'
    }).single()

    if (res.count != null) {
      // TODO extract applying changes logic in a private method
      obj.synced = true;
      obj.updated_at = merged.updated_at;
      // TODO apply all changes after merge
      await (db as any)[type].put(obj); // FIXME find a better way to do this
    }

    return { data: merged.content, error : res.error };
  }

  async syncPendingFromTable<T extends Syncable>(type: keyof typeof db): Promise<void> {
    const table = (db as any)[type] as Dexie.Table<T, any> // FIXME find a better way to do this
    const unsynced = await table.where({synced: true}).toArray()

    for (const entity of unsynced) {
      await this.sync<T>(entity, type)
    }
  }
}

export interface SyncResult<T extends Syncable> {
  data: T
  error: PostgrestError | null
}

interface Backup<T extends Syncable> {
  id: string | null;
  user_id: string;
  object_id: string;
  object_type: string;
  content: T;
  updated_at: string;
}