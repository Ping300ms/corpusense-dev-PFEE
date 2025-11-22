import { useEffect, useState } from "react";
import { db } from "@/data/repositories/indexeddb/db";
import { Button } from "@/components/ui/button";
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { Annotation } from '@/data/models/Annotation.ts';
import { DataModel } from '@/data/models/DataModel.ts';
import { EntityTable } from 'dexie';
import { SyncableObject } from '@/data/models/Syncable.ts';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';
import { v4 as uuidv4 } from 'uuid';

export default function LoadTestPage() {
  const [collections, setCollections] = useState<CollectionDetails[]>([]);
  const [collectionContent, setCollectionContent] = useState<CollectionContent[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [models, setModels] = useState<DataModel[]>([]);
  const [testRunning, setTestRunning] = useState(false)



  const loadData = async () => {
    setCollections(await db.collections.toArray());
    setCollectionContent(await db.collectionContents.toArray());
    setAnnotations(await db.annotations.toArray());
    setModels(await db.models.toArray());
  };

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  function newCollection(): CollectionDetails {
    return {
      id: uuidv4(),
      name: uuidv4(),
      about: uuidv4(),
      tags: [uuidv4(), uuidv4()],
      modelId: uuidv4(),
      contentSize: 0,
      offline: false
    };
  }

  useEffect(() => {
    if (!testRunning) return;

    let cancelled = false;
    const run = async () => {
      await loadData();
      console.log("Starting Load Test");
      const maxEntity = 100;
      let entityNumber = 0;
      while (!cancelled && testRunning && entityNumber < maxEntity) {
        const collection = newCollection()
        await db.collections.put(collection);
        await sleep(1000);
        await db.collections.delete(collection.id);
        await sleep(1000);
        entityNumber++;
      }
      setTestRunning(false);
      console.log("Finished Load Test");
    };
    void run();

    return () => { cancelled = true; };
  }, [testRunning]);


  const startAndStopTest = () => {
    setTestRunning(prev => !prev);
  };


  useEffect(() => {
    void loadData();
    new DexieObservableListener(
      db,
      {
        onInsertItem: () => loadData(),
        onUpdateItem: () => loadData(),
        onDeleteItem: () => loadData(),
      });
  }, []);

  const handleDelete = async (table: keyof typeof db, id: string) => {
    await (db[table] as unknown as EntityTable<SyncableObject, 'id'>).delete(id);
    await loadData();
  };

  return (
    <div className="panel p-4 space-y-6">
      <h1 className="text-2xl font-bold">📚 Home</h1>
      <Button onClick={startAndStopTest}>{testRunning ? "Stop Test" : "Start Test"}</Button>

      {/* Collections */}
      <EntitySection title="Collections" data={collections} table="collections" onDelete={handleDelete} linkBase="/test/collection" />

      {/* Collections Contents */}
      <EntitySection title="Collections Contents" data={collectionContent} table="collectionContents" onDelete={handleDelete} linkBase="/test/collection-content" />

      {/* Annotations */}
      <EntitySection title="Annotations" data={annotations} table="annotations" onDelete={handleDelete} linkBase="/test/annotation" />

      {/* Data Models */}
      <EntitySection title="Data Models" data={models} table="models" onDelete={handleDelete} linkBase="/test/model" />

    </div>
  );
}

function EntitySection({ title, data, table, onDelete, linkBase } : { title: string, data: SyncableObject[], table: keyof typeof db, onDelete: (table: keyof typeof db, id: string) => Promise<void>, linkBase: string }) {
  return (
    <section className="panel space-y-2">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <ul className="divide-y divide-gray-200">
        {data.map((d: SyncableObject) => (
          <li key={d.id} className="flex justify-between py-1">
            <span>{d.id}</span>
          </li>
        ))}
      </ul>

    </section>
  );
}