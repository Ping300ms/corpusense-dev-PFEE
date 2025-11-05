import { useEffect, useState } from "react";
import { db } from "@/data/repositories/indexeddb/db";
import { Button } from "@/components/ui/button";
import { Trash2 } from 'lucide-react';
import { CollectionContent } from '@/data/models/Collection.ts';
import { EntityTable } from 'dexie';
import { DexieObservableListener } from '@/data/repositories/indexeddb/dexieObservableListener.ts';
import { CollectionElement } from '@/data/models/CollectionElement.ts';
import { v4 as uuid } from 'uuid';

export default function BulkPage() {
  const [collectionContent, setCollectionContent] = useState<CollectionContent[]>([])
  let dexieListener : DexieObservableListener | null = null;

  const createCollectionContentObject = () : CollectionContent => {
    return {
      id : uuid(),
      content : [] as CollectionElement[],
      updated_at: new Date().toISOString(),
    } as CollectionContent;
  }

  const loadData = async () => {
    setCollectionContent(await db.collectionContents.toArray());
  };

  useEffect(() => {
    void loadData();
    if (dexieListener == null) {
      dexieListener = new DexieObservableListener(
        db,
        {
          onAdd: (p) => {
            void loadData();
            console.log("added " + p.id)
          },
          onUpdate: (p) => {
            void loadData();
            console.log("updated " + p.id)
          },
          onDelete: (p) => {
            void loadData();
            console.log("deleted " + p)
          },
        });
    }
  }, []);

  const handleDelete = async (table: keyof typeof db) => {
    await (db[table] as unknown as EntityTable<CollectionContent, 'id'>).bulkDelete(collectionContent.map((c) => c.id));
  };

  const handleCreate = async (table: keyof typeof db) => {
    await (db[table] as unknown as EntityTable<CollectionContent>).bulkAdd([
      createCollectionContentObject(),
      createCollectionContentObject(),
      createCollectionContentObject(),
    ]);
  }

  const handleUpdate = async (table: keyof typeof db) => {
    for (const c of collectionContent) {
      c.updated_at = new Date().toISOString();
    }
    // @ts-expect-error
    await (db[table] as unknown as EntityTable<CollectionContent, 'id'>).bulkUpdate(collectionContent.map((c) => {return { key: c.id, changes : c}}));
  }

  return (
    <div className="panel p-4 space-y-6">
      <h1 className="text-2xl font-bold">📚 Home</h1>
      {/* Collections Contents */}
      <section className="panel space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">{"Collections Contents"}</h2>
          <Button variant="default" onClick={() => void handleCreate("collectionContents")}>Add</Button>
          <Button variant="default" onClick={() => void handleUpdate("collectionContents")}>Update</Button>
          <Button size="icon" variant="ghost" onClick={() => void handleDelete("collectionContents")}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
        <ul className="divide-y divide-gray-200">
          {collectionContent.map((d: CollectionContent) => (
            <li key={d.id} className="flex justify-between py-1">
              <span>{d.id} - {d.updated_at}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
