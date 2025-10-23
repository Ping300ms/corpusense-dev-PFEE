import { describe, it, expect } from 'vitest';
import {
  syncableToUint8,
  uint8ToSyncable,
} from '@/data/repositories/supabase/yjsUtils';
import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel.ts';
import { Syncable } from '@/data/models/Syncable.ts';
import { v4 as uuid } from 'uuid';

// helper générique de symétrie
function testSymmetry<T extends Syncable>(label: string, obj: T) {
  it(`should preserve full data integrity for ${label}`, () => {
    const encoded = syncableToUint8(obj);
    const decoded = uint8ToSyncable<T>(encoded);
    expect(decoded).toEqual(obj);
  });
}

describe('Yjs Syncable symmetry tests', () => {
  const now = new Date().toISOString();

  //
  // --- 1. Annotation ---
  //
  describe('Annotation', () => {
    const annotation: Annotation = {
      id: uuid(),
      updated_at: now,
      canvasId: uuid(),
      collectionId: uuid(),
      order: 3,
      partOf: 'root-segment',
      previous: 'prev-id',
      next: 'next-id',
      // propriétés héritées potentiellement ajoutées dynamiquement
      label: 'Segment principal',
      metadata: {
        author: 'Alice',
        confidence: 0.92,
        notes: ['point A', 'point B'],
      },
    } as any; // cast loose car structure potentiellement enrichie

    testSymmetry('Annotation', annotation);
  });

  //
  // --- 2. CollectionDetails ---
  //
  describe('CollectionDetails', () => {
    const collection: CollectionDetails = {
      id: uuid(),
      updated_at: now,
      name: 'Projet Atlas',
      about:
        'Description longue '.repeat(10) + 'fin de texte',
      tags: ['AI', 'vision', 'dataset'],
      modelId: uuid(),
      contentSize: 512,
      offline: true,
    };

    testSymmetry('CollectionDetails', collection);
  });

  //
  // --- 3. CollectionContent ---
  //
  describe('CollectionContent', () => {
    const content: CollectionContent = {
      id: uuid(),
      updated_at: now,
      content: [
        {
          canvasId: "abcde",
          manifestId: "klmn",
          position: 1,
        },
        {
          canvasId: "fghi",
          manifestId: "opqrs",
          position: 1,
        },
      ],
    };

    testSymmetry('CollectionContent', content);
  });

  //
  // --- 4. DataModel ---
  //
  describe('DataModel', () => {
    const model: DataModel = {
      id: uuid(),
      updated_at: now,
      name: 'Medical Record Model',
      description:
        'Modèle pour les fiches patient.\n'.repeat(4) +
        'Doit supporter texte long.',
      prompt: 'Génère un résumé structuré des informations cliniques.',
      fields: [
        {
          id: uuid(),
          name: 'patient_name',
          type: 'string',
          description: 'Nom complet du patient',
          color: '#00AAFF',
        },
        {
          id: uuid(),
          name: 'diagnosis',
          type: 'text',
          description:
            'Diagnostic complet et historique médical ' + 'a'.repeat(200),
          color: '#FF3355',
        },
        {
          id: uuid(),
          name: 'symptoms',
          type: 'array',
          isArray: true,
          color: '#AABBCC',
          description: 'Liste des symptômes principaux',
        },
        {
          id: uuid(),
          name: 'measurements',
          type: 'object',
          color: '#22CC88',
          description: 'Sous-objet avec valeurs numériques',
          generated: true,
        },
      ],
    };

    testSymmetry('DataModel', model);
  });

  //
  // --- 5. Mixed deeply nested composite ---
  //
  describe('Composite nested object', () => {
    const complex = {
      id: uuid(),
      updated_at: now,
      name: 'Nested Object Test',
      metadata: {
        author: { id: uuid(), name: 'Bob', roles: ['admin', 'reviewer'] },
        versions: [
          { id: uuid(), note: 'initial' },
          { id: uuid(), note: 'update 1' },
        ],
      },
      items: [
        {
          id: uuid(),
          type: 'sub-item',
          data: {
            a: 1,
            b: 2,
            c: ['alpha', 'beta', 'gamma'],
            d: { nestedKey: 'nestedValue' },
          },
        },
      ],
      longText: 'L'.repeat(256),
      flags: [true, false, true],
    };

    testSymmetry('Composite Nested Object', complex);
  });
});
