/* eslint-disable */
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/data/repositories/indexeddb/db";
import { Button } from "@/components/ui/button";
import type { CollectionContent } from "@/data/models/Collection";

export default function EditCollectionContentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState<CollectionContent>(newCollectionContent());

  // Chargement si on édite un contenu existant
  useEffect(() => {
    if (id !== undefined && id !== "new") {
      db.collectionContents.get(id).then((c) => {
        if (c) setContent(c);
      });
    }
  }, [id]);

  // Sauvegarde (met à jour updated_at)
  const handleSave = async () => {
    const toSave = { ...content, updated_at: new Date().toISOString() };
    await db.collectionContents.put(toSave);
    navigate("/test");
  };

  // === Gestion dynamique des éléments ===
  const handleAddItem = () => {
    setContent((prev) => {
      const nextPos = prev.content.length > 0 ? Math.max(...prev.content.map(i => i.position)) + 1 : 1;
      const newItem = {
        canvasId: "",
        manifestId: "",
        position: nextPos,
      };
      return { ...prev, content: [...prev.content, newItem] };
    });
  };

  const handleItemChange = (index: number, field: string, value: string | number) => {
    setContent((prev) => {
      const newItems = prev.content.map((it, i) => (i === index ? { ...it, [field]: value } : it));
      return { ...prev, content: newItems };
    });
  };

  const handleDeleteItem = (index: number) => {
    setContent((prev) => ({ ...prev, content: prev.content.filter((_, i) => i !== index) }));
  };

  return (
    <div className="panel p-6 space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">🗂️ Édition du Contenu de Collection</h1>

      {/* ID (readonly) */}
      <div>
        <label className="block text-sm font-medium text-gray-700">ID</label>
        <div className="p-2 rounded border bg-gray-50 text-sm">{content.id}</div>
      </div>

      {/* Liste d'éléments */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">📋 Éléments</h2>
          <Button variant="outline" onClick={handleAddItem}>➕ Ajouter un élément</Button>
        </div>

        {content.content.length === 0 && (
          <p className="text-sm text-gray-500">Aucun élément pour l’instant.</p>
        )}

        <div className="space-y-3">
          {content.content.map((item, index) => (
            <div key={`${item.canvasId}-${item.manifestId}-${index}`} className="border rounded p-4 bg-white shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-sm font-medium">canvasId</span>
                  <input
                    className="mt-1 block w-full border rounded p-2"
                    value={item.canvasId}
                    onChange={(e) => handleItemChange(index, "canvasId", e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium">manifestId</span>
                  <input
                    className="mt-1 block w-full border rounded p-2"
                    value={item.manifestId}
                    onChange={(e) => handleItemChange(index, "manifestId", e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium">position</span>
                  <input
                    type="number"
                    className="mt-1 block w-full border rounded p-2"
                    value={item.position}
                    onChange={(e) => handleItemChange(index, "position", Number(e.target.value))}
                  />
                </label>
              </div>

              <div className="flex justify-end mt-3">
                <Button variant="destructive" size="sm" onClick={() => handleDeleteItem(index)}>🗑️ Supprimer</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate("/test")}>Annuler</Button>
        <Button onClick={handleSave}>Sauvegarder</Button>
      </div>
    </div>
  );
}

// helper qui crée un CollectionContent minimal
function newCollectionContent(): CollectionContent {
  return {
    id: uuidv4(),
    content: [
      {
        canvasId: "test",
        manifestId: "test",
        position: 1,
      },
    ],
    updated_at: new Date().toISOString(),
  };
}
