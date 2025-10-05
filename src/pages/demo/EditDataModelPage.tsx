/* eslint-disable */
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/data/repositories/indexeddb/db";
import { Button } from "@/components/ui/button";
import { DataModel, DataField } from "@/data/models/DataModel.ts";

export default function EditDataModelPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [model, setModel] = useState<DataModel>(newDataModel());

  // Chargement du modèle existant si ID fourni
  useEffect(() => {
    if (id !== undefined && id !== "new") {
      db.models.get(id).then((m) => m && setModel(m));
    }
  }, [id]);

  const handleSave = async () => {
    await db.models.put(model);
    navigate("/test");
  };

  const handleChange = (key: keyof DataModel, value: any) => {
    setModel((prev) => ({ ...prev, [key]: value }));
  };

  // === Gestion des Fields ===
  const handleAddField = () => {
    const newField: DataField = {
      id: uuidv4(),
      name: "",
      type: "",
      color: "#000000",
    };
    setModel((prev) => ({ ...prev, fields: [...prev.fields, newField] }));
  };

  const handleFieldChange = (fieldId: string, key: keyof DataField, value: any) => {
    setModel((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, [key]: value } : f)),
    }));
  };

  const handleDeleteField = (fieldId: string) => {
    setModel((prev) => ({
      ...prev,
      fields: prev.fields.filter((f) => f.id !== fieldId),
    }));
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">🧠 Édition Data Model</h1>

      {/* Champs principaux */}
      <div className="space-y-3">
        <label className="block">
          <span className="font-semibold">Nom du modèle</span>
          <input
            className="border p-2 w-full rounded"
            value={model.name}
            onChange={(e) => handleChange("name", e.target.value)}
          />
        </label>

        <label className="block">
          <span className="font-semibold">Description</span>
          <textarea
            className="border p-2 w-full rounded"
            value={model.description}
            onChange={(e) => handleChange("description", e.target.value)}
          />
        </label>

        <label className="block">
          <span className="font-semibold">Prompt</span>
          <input
            className="border p-2 w-full rounded"
            value={model.prompt}
            onChange={(e) => handleChange("prompt", e.target.value)}
          />
        </label>
      </div>

      {/* Liste des Fields */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">🧩 Champs du modèle</h2>
          <Button variant="outline" onClick={handleAddField}>
            ➕ Ajouter un champ
          </Button>
        </div>

        {model.fields.length === 0 && (
          <p className="text-sm text-gray-500">Aucun champ pour l’instant.</p>
        )}

        <div className="space-y-3">
          {model.fields.map((field) => (
            <div
              key={field.id}
              className="border rounded p-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
            >
              <div className="flex flex-col sm:flex-row gap-2 flex-1">
                <input
                  placeholder="Nom"
                  className="border p-2 rounded flex-1"
                  value={field.name}
                  onChange={(e) => handleFieldChange(field.id, "name", e.target.value)}
                />
                <input
                  placeholder="Type"
                  className="border p-2 rounded flex-1"
                  value={field.type}
                  onChange={(e) => handleFieldChange(field.id, "type", e.target.value)}
                />
                <input
                  type="color"
                  className="border p-1 rounded w-16"
                  value={field.color}
                  onChange={(e) => handleFieldChange(field.id, "color", e.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                onClick={() => handleDeleteField(field.id)}
                className="text-sm px-3 py-1"
              >
                🗑️ Supprimer
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate("/test")}>
          Annuler
        </Button>
        <Button onClick={handleSave}>Sauvegarder</Button>
      </div>
    </div>
  );
}

// === Helpers ===
function newDataModel(): DataModel {
  return {
    id: uuidv4(),
    name: "Nouveau modèle",
    description: "",
    prompt: "",
    fields: [],
    updated_at: new Date().toISOString(),
  };
}
