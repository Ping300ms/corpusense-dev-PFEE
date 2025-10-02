import { useEffect, useState } from "react";
import { Button } from '@/components/ui/button';
import { Trash2 } from "lucide-react";
import { db } from "@/data/repositories/indexeddb/db";
import { v4 as uuidv4 } from 'uuid';
import { SyncManager } from '@/data/repositories/supabase/syncManager';
import { Collection, CollectionDetails } from '@/data/models/Collection';
import { DataModel } from '@/data/models/DataModel';
import { Annotation } from '@/data/models/Annotation';
import { ShapeType } from '@annotorious/annotorious';
import Dexie from 'dexie';
import { Syncable } from '@/data/models/Syncable.ts';

const sync = SyncManager.getInstance();

const TestPage = () => {
  const [collections, setCollections] = useState<CollectionDetails[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [models, setModels] = useState<DataModel[]>([]);

  const loadData = async () => {
    setCollections(await db.collections.toArray());
    setAnnotations(await db.annotations.toArray());
    setModels(await db.models.toArray());
  };

  useEffect(() => {
    void loadData();
  }, []);

  // --- Factories ---
  const newCollection = (): Collection => ({
    id: uuidv4(),
    name: "New Collection",
    about: "Test collection",
    tags: ["test"],
    modelId: undefined,
    contentSize: 0,
    content: [],
    updated_at: new Date().toISOString(),
    synced: false,
  });

  const newAnnotation = (): Annotation => {
    const annotationId = uuidv4();
    return {
      id: annotationId,
      canvasId: "canvas-1",
      collectionId: "col-1",
      order: Math.floor(Math.random() * 100),
      updated_at: new Date().toISOString(),
      synced: false,
      target: { selector: { type: ShapeType.RECTANGLE, geometry: { bounds: { minY: 0, minX: 0, maxY: 0, maxX: 0 } } }, annotation: annotationId },
      bodies: [],
    };
  };

  const newModel = (): DataModel => ({
    id: uuidv4(),
    name: "TestModel",
    description: "A demo model",
    prompt: "Describe something",
    fields: [],
    updated_at: new Date().toISOString(),
    synced: false,
  });

  // --- Actions ---
  const handleCreate = async <T extends Syncable>(entity: T, type: keyof typeof db) => {
    await (db[type] as unknown as Dexie.Table<T, T>).put(entity);
    await sync.create(entity, type);
    await loadData();
  };

  const handleSyncPending = async (type: keyof typeof db) => {
    await sync.pushPending(type);
    await loadData();
  };

  const handlePull = async (type: keyof typeof db) => {
    await sync.pullUpdates(type);
    await loadData();
  };

  const handleDelete = async <T extends Syncable>(type: keyof typeof db, id: string) => {
    await sync.delete(id, type);
    // @ts-expect-error idk why
    await (db[type] as unknown as Dexie.Table<T, T>).delete(id);
    await loadData();
  };

  const handleDeleteTable = async <T extends Syncable>(type: keyof typeof db) => {
    const table = (db[type] as unknown as Dexie.Table<T, T>);
    const allIds = (await table.toArray()).map((o: { id: string }) => o.id);
    await sync.deleteByIds(allIds, type);
    await table.clear();
    await loadData();
  };

  // --- UI ---
  return (
    <div className="panel h-full w-full flex flex-col space-y-4">
      <h1 className="text-2xl font-bold">Test Sync Manager</h1>

      {/* Collections */}
      <section className="panel space-y-2">
        <h2 className="text-lg font-semibold">Collections</h2>
        <div className="flex space-x-2">
          <Button onClick={() => void handleCreate<CollectionDetails>(newCollection(), "collections")}>Add Collection</Button>
          <Button variant="secondary" onClick={() => void handleSyncPending("collections")}>Sync Pending</Button>
          <Button variant="outline" onClick={() => void handlePull("collections")}>Pull Remote</Button>
          <Button variant="destructive" onClick={() => void handleDeleteTable<CollectionDetails>("collections")}>Delete All</Button>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {collections.map((c) => (
            <li key={c.id} className="flex justify-between items-center border-b pb-1">
              <div>
                {c.name} <span className="text-muted-foreground">– synced: {String(c.synced)} – {c.updated_at}</span>
              </div>
              <Button size="icon" variant="ghost" onClick={() => void handleDelete<CollectionDetails>("collections", c.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {/* Annotations */}
      <section className="panel space-y-2">
        <h2 className="text-lg font-semibold">Annotations</h2>
        <div className="flex space-x-2">
          <Button onClick={() => void handleCreate<Annotation>(newAnnotation(), "annotations")}>Add Annotation</Button>
          <Button variant="secondary" onClick={() => void handleSyncPending("annotations")}>Sync Pending</Button>
          <Button variant="outline" onClick={() => void handlePull("annotations")}>Pull Remote</Button>
          <Button variant="destructive" onClick={() => void handleDeleteTable<Annotation>("annotations")}>Delete All</Button>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {annotations.map((a) => (
            <li key={a.id} className="flex justify-between items-center border-b pb-1">
              <div>
                {a.id} – order: {a.order} <span className="text-muted-foreground">– synced: {String(a.synced)}</span>
              </div>
              <Button size="icon" variant="ghost" onClick={() => void handleDelete<Annotation>("annotations", a.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {/* Models */}
      <section className="panel space-y-2">
        <h2 className="text-lg font-semibold">Data Models</h2>
        <div className="flex space-x-2">
          <Button onClick={() => void handleCreate<DataModel>(newModel(), "models")}>Add Model</Button>
          <Button variant="secondary" onClick={() => void handleSyncPending("models")}>Sync Pending</Button>
          <Button variant="outline" onClick={() => void handlePull("models")}>Pull Remote</Button>
          <Button variant="destructive" onClick={() => void handleDeleteTable<DataModel>("models")}>Delete All</Button>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {models.map((m) => (
            <li key={m.id} className="flex justify-between items-center border-b pb-1">
              <div>
                {m.name} <span className="text-muted-foreground">– synced: {String(m.synced)} – {m.updated_at}</span>
              </div>
              <Button size="icon" variant="ghost" onClick={() => void handleDelete<DataModel>("models", m.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default TestPage;
