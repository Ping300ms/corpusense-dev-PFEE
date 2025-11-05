import { createTestDb, createTestDbSync, clearTestDatabases } from './testDbFactory';
import { SyncManager } from '@/data/repositories/supabase/syncManager.ts';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'fake-indexeddb/auto';

export interface SyncTestEnv {
  client: SupabaseClient;
  db: ReturnType<typeof createTestDb>;
  dbSync: ReturnType<typeof createTestDbSync>;
  syncManager: SyncManager;
}

/**
 * Prépare un environnement de test fonctionnel pour le SyncManager.
 */
export async function setupSyncTestEnv(): Promise<SyncTestEnv> {
  await clearTestDatabases();

  const db = createTestDb();
  const dbSync = createTestDbSync();
  const client = createClient(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string
  );

  await client.auth.signUp({ email: 'yann@gmail.com', password: 'yann@gmail.com' });

  await Promise.all([db.open(), dbSync.open()]);

  // Instanciation du SyncManager avec les DB de test
  const syncManager = SyncManager.getInstance(
    client,
    db,
    dbSync
  );

  return { client, db, dbSync, syncManager };
}

/**
 * Nettoyage après test
 */
export async function teardownSyncTestEnv() {
  await clearTestDatabases();
}
