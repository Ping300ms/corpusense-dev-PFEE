/* eslint-disable */
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/data/repositories/indexeddb/db";
import { Button } from "@/components/ui/button";
import { CollectionDetails } from "@/data/models/Collection.ts";

export default function EditCollectionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<CollectionDetails>(newCollection());

  // --- Chargement si on édite une collection existante ---
  useEffect(() => {
    if (id && id !== "new") {
      db.collections.get(id).then((c) => c && setCollection(c));
    }
  }, [id]);

  // --- Sauvegarde ---
  const handleSave = async () => {
    await db.collections.put(collection);
    navigate("/test");
  };

  const handleChange = (key: keyof CollectionDetails, value: any) => {
    setCollection((prev) => ({ ...prev, [key]: value }));
  };

  // --- Gestion des Tags ---
  const handleAddTag = () => {
    setCollection((prev) => ({ ...prev, tags: [...prev.tags, ""] }));
  };

  const handleTagChange = (index: number, value: string) => {
    setCollection((prev) => {
      const newTags = [...prev.tags];
      newTags[index] = value;
      return { ...prev, tags: newTags };
    });
  };

  const handleDeleteTag = (index: number) => {
    setCollection((prev) => {
      const newTags = prev.tags.filter((_, i) => i !== index);
      return { ...prev, tags: newTags };
    });
  };

  return (
    <div className="panel p-6 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">📦 Édition Collection</h1>

      {/* Champs principaux */}
      <div className="space-y-3">
        <label className="block">
          <span className="font-semibold">Nom de la collection</span>
          <input
            className="border p-2 w-full rounded"
            value={collection.name}
            onChange={(e) => handleChange("name", e.target.value)}
          />
        </label>

        <label className="block">
          <span className="font-semibold">Description</span>
          <textarea
            className="border p-2 w-full rounded"
            value={collection.about}
            onChange={(e) => handleChange("about", e.target.value)}
          />
        </label>

        <label className="block">
          <span className="font-semibold">Nombre d’éléments</span>
          <input
            type="number"
            className="border p-2 w-full rounded"
            value={collection.contentSize}
            onChange={(e) => handleChange("contentSize", Number(e.target.value))}
          />
        </label>
      </div>

      {/* Gestion des tags */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">🏷️ Tags</h2>
          <Button variant="outline" onClick={handleAddTag}>
            ➕ Ajouter un tag
          </Button>
        </div>

        {collection.tags.length === 0 && (
          <p className="text-sm text-gray-500">Aucun tag pour l’instant.</p>
        )}

        <div className="space-y-2">
          {collection.tags.map((tag, index) => (
            <div
              key={index}
              className="flex items-center gap-2 border rounded p-2 bg-gray-50"
            >
              <input
                className="border p-2 flex-1 rounded"
                value={tag}
                onChange={(e) => handleTagChange(index, e.target.value)}
                placeholder={`Tag #${index + 1}`}
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteTag(index)}
              >
                🗑️
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Boutons d’action */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate("/test")}>
          Annuler
        </Button>
        <Button onClick={handleSave}>Sauvegarder</Button>
      </div>
    </div>
  );
}

// --- Helper ---
function newCollection(): CollectionDetails {
  return {
    id: uuidv4(),
    name: "Nouvelle collection",
    about: "Description de la collection",
    tags: ["exemple"],
    modelId: uuidv4(),
    contentSize: 0,
    updated_at: new Date().toISOString(),
  };
}
