import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "@/data/repositories/indexeddb/db";
import { Button } from "@/components/ui/button";
import { Trash2, Edit3 } from "lucide-react";
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { Annotation } from '@/data/models/Annotation.ts';
import { DataModel } from '@/data/models/DataModel.ts';
import { EntityTable } from 'dexie';
import { SyncableObject } from '@/data/models/Syncable.ts';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';

export default function HomePage() {
  const [collections, setCollections] = useState<CollectionDetails[]>([]);
  const [collectionContent, setCollectionContent] = useState<CollectionContent[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [models, setModels] = useState<DataModel[]>([]);

  const loadData = async () => {
    setCollections(await db.collections.toArray());
    setCollectionContent(await db.collectionContents.toArray());
    setAnnotations(await db.annotations.toArray());
    setModels(await db.models.toArray());
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
        <Link to={`${linkBase}/new`}>
          <Button variant="default">+ Ajouter</Button>
        </Link>
      </div>
      <ul className="divide-y divide-gray-200">
        {data.map((d: SyncableObject) => (
          <li key={d.id} className="flex justify-between py-1">
            <span>{d.id} - {d.updated_at}</span>
            <div className="flex gap-2">
              <Link to={`${linkBase}/${d.id}`}>
                <Button size="icon" variant="outline"><Edit3 className="h-4 w-4" /></Button>
              </Link>
              <Button size="icon" variant="ghost" onClick={() => void onDelete(table, d.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
