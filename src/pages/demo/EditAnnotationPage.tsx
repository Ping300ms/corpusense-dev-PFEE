/* eslint-disable */
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/data/repositories/indexeddb/db";
import { Button } from "@/components/ui/button";
import { ShapeType } from "@annotorious/annotorious";
import { Annotation } from '@/data/models/Annotation.ts';

export default function EditAnnotationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [annotation, setAnnotation] = useState<Annotation>(newAnnotation());

  useEffect(() => {
    if (id !== undefined && id !== "new") {
      db.annotations.get(id).then(a => a && setAnnotation(a));
    }
  }, [id]);

  const handleSave = async () => {
    await db.annotations.put(annotation);
    navigate("/test");
  };

  
  const handleChange = (key: string, value: any) => {
    setAnnotation((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-4 space-y-4">
    <h1 className="text-xl font-bold">✏️ Édition Annotation</h1>

  <label className="block">
    Canvas ID
  <input className="border p-2 w-full" value={annotation.canvasId} onChange={e => handleChange("canvasId", e.target.value)} />
  </label>

  <label className="block">
    Collection ID
  <input className="border p-2 w-full" value={annotation.collectionId} onChange={e => handleChange("collectionId", e.target.value)} />
  </label>

  <label className="block">
    Order
    <input type="number" className="border p-2 w-full" value={annotation.order} onChange={e => handleChange("order", Number(e.target.value))} />
  </label>

  <label className="block">
    Body Value
  <input className="border p-2 w-full"
  value={annotation.bodies[0].value}
  onChange={e => {
    const newBodies = [...annotation.bodies];
    newBodies[0].value = e.target.value;
    setAnnotation({ ...annotation, bodies: newBodies });
  }}
  />
  </label>

  <div className="flex justify-end gap-2">
  <Button variant="outline" onClick={() => navigate("/test")}>Annuler</Button>
  <Button onClick={handleSave}>Sauvegarder</Button>
    </div>
    </div>
);
}

function newAnnotation() {
  const annotationId = uuidv4();
  return {
    id: annotationId,
    canvasId: "canvas-1",
    collectionId: "col-1",
    order: Math.floor(Math.random() * 100),
    updated_at: new Date().toISOString(),
    target: {
      selector: {
        type: ShapeType.RECTANGLE,
        geometry: { bounds: { minY: 0, minX: 0, maxY: 0, maxX: 0 } },
      },
      annotation: annotationId,
    },
    bodies: [
      { id: uuidv4(), annotation: annotationId, value: "test", type: "test", purpose: "describing" },
    ],
  };
}
