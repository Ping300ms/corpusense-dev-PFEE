import { describe, it, beforeEach, afterEach } from 'vitest';
import { setupSyncTestEnv, teardownSyncTestEnv } from './setupSyncTestEnv';
import { v4 as uuid } from 'uuid';
import { CollectionDetails } from '@/data/models/Collection.ts';
import { SupabaseRealtimeListener } from '@/data/repositories/supabase/SupabaseRealtimeListener.ts';
import 'fake-indexeddb/auto';

describe('SyncManager (fonctionnel)', () => {
  let env: Awaited<ReturnType<typeof setupSyncTestEnv>>;

  beforeEach(async () => {
    env = await setupSyncTestEnv();
  });

  afterEach(async () => {
    await teardownSyncTestEnv();
  });

  it('add a collection to dexie then sync to supabase then delete both', async () => {
    const collection : CollectionDetails = {
      id: uuid(),
      name: "string",
      tags: [],
      contentSize: 0,
      offline: true,
      updated_at: new Date().toISOString()
    } as CollectionDetails;

    let hasBeenCreated = false;
    let hasBeenDeleted = false;

    const realtimeListener = new SupabaseRealtimeListener({
      channelBaseName: 'backup',
      onDelete : () => {},
      onInsert : async (p) => {
        expect(p.new).not.toBeNull();
        if (p.new.id !== collection.id) return;
        hasBeenCreated = true;
        await env.db.collections.delete(collection.id);
      },
      onUpdate : async (p) => {
        expect(p.new).not.toBeNull();
        if (p.new.id !== collection.id) return;
        hasBeenDeleted = true;
        expect(p.new.deleted_at).not.toBeNull();
        await realtimeListener.removeExistingChannel();
      },
      supabaseClient: env.client, tableName: 'backup'
    })

    await realtimeListener.subscribe();

    await env.db.collections.put(collection);

    await new Promise(f => setTimeout(f, 2000));

    expect(hasBeenCreated).toBe(true);
    expect(hasBeenDeleted).toBe(true);
  });

  it('vide la file de sync après traitement', async () => {

  });
});
