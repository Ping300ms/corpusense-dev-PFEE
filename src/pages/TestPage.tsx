import { useEffect, useState } from "react";
import { Button } from '@/components/ui/button';
import { db } from "@/data/repositories/indexeddb/db";
import { v4 as uuidv4 } from 'uuid';
import { SyncManager } from '@/data/supabase/syncManager';
import { Collection, CollectionDetails } from '@/data/models/Collection';
import { DataModel } from '@/data/models/DataModel';
import { Annotation } from '@/data/models/Annotation.ts';
import { ShapeType } from '@annotorious/annotorious';

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

  const annotationId = uuidv4();
  const newAnnotation = (): Annotation => ({
    id: annotationId,
    canvasId: "canvas-1",
    collectionId: "col-1",
    order: Math.floor(Math.random() * 100),
    updated_at: new Date().toISOString(),
    synced: false,
    target: {selector: {type: ShapeType.RECTANGLE, geometry: {bounds: {minY: 0, minX: 0, maxY: 0, maxX: 0}}}, annotation: annotationId},
    bodies: [],
  });

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
  const handleCreate = async <T extends { id: string }>(entity: T, type: keyof typeof db) => {
    await (db as any)[type].put(entity);
    await sync.create(entity as any, type);
    await loadData();
  };

  const handleSyncPending = async (type: keyof typeof db) => {
    await sync.syncPendingFromTable(type);
    await loadData();
  };

  const handlePull = async (type: keyof typeof db) => {
    await sync.pullFromRemote(type);
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
          <Button onClick={() => handleCreate(newCollection(), "collections")}>
            Add Collection
          </Button>
          <Button variant="secondary" onClick={() => handleSyncPending("collections")}>
            Sync Pending
          </Button>
          <Button variant="outline" onClick={() => handlePull("collections")}>
            Pull Remote
          </Button>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {collections.map((c) => (
            <li key={c.id} className="flex justify-between border-b pb-1">
              <span>{c.name}</span>
              <span className="text-muted-foreground">
            synced: {String(c.synced)} – {c.updated_at}
          </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Annotations */}
      <section className="panel space-y-2">
        <h2 className="text-lg font-semibold">Annotations</h2>
        <div className="flex space-x-2">
          <Button onClick={() => handleCreate(newAnnotation(), "annotations")}>
            Add Annotation
          </Button>
          <Button variant="secondary" onClick={() => handleSyncPending("annotations")}>
            Sync Pending
          </Button>
          <Button variant="outline" onClick={() => handlePull("annotations")}>
            Pull Remote
          </Button>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {annotations.map((a) => (
            <li key={a.id} className="flex justify-between border-b pb-1">
              <span>{a.id} – order: {a.order}</span>
              <span className="text-muted-foreground">synced: {String(a.synced)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Models */}
      <section className="panel space-y-2">
        <h2 className="text-lg font-semibold">Data Models</h2>
        <div className="flex space-x-2">
          <Button onClick={() => handleCreate(newModel(), "models")}>
            Add Model
          </Button>
          <Button variant="secondary" onClick={() => handleSyncPending("models")}>
            Sync Pending
          </Button>
          <Button variant="outline" onClick={() => handlePull("models")}>
            Pull Remote
          </Button>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {models.map((m) => (
            <li key={m.id} className="flex justify-between border-b pb-1">
              <span>{m.name}</span>
              <span className="text-muted-foreground">
            synced: {String(m.synced)} – {m.updated_at}
          </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default TestPage;
