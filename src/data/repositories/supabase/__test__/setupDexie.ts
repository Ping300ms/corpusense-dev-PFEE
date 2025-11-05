import 'fake-indexeddb/auto';
import Dexie from 'dexie';

// Empêche les logs Dexie dans la console de test
Dexie.debug = false;

// Nettoyage avant chaque test utilisant Dexie
beforeEach(async () => {
  const dbs = await Dexie.getDatabaseNames();
  await Promise.all(dbs.map(name => Dexie.delete(name)));
});

// Nettoyage final
afterAll(async () => {
  const dbs = await Dexie.getDatabaseNames();
  await Promise.all(dbs.map(name => Dexie.delete(name)));
});