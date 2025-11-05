import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  syncableToUint8,
  uint8ToSyncable,
  mergeDocs,
  encodeDocToJSONB,
  decodeUintFromJSONB, syncableToDoc, uint8toDoc,
} from '@/data/repositories/supabase/yjsUtils';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel.ts';
import { Annotation } from '@/data/models/Annotation.ts';
import { v4 as uuid } from 'uuid';
import { Syncable } from '@/data/models/Syncable.ts';

const now = () => new Date().toISOString();

describe('Yjs Syncable utilities', () => {
  const baseObject: CollectionDetails = {
    id: '123',
    updated_at: new Date().toISOString(),
    name: 'My Collection',
    about: 'Some details',
    tags: ['science', 'math'],
    contentSize: 2,
    offline: false,
  } as CollectionDetails;

  it('should merge changes correctly', () => {
    const localEncoded = syncableToUint8(baseObject);
    const remote = uint8ToSyncable<CollectionDetails>(localEncoded);
    expect(remote).toEqual(baseObject);
    // simulate remote changes
    remote.tags.push('science');
    remote.contentSize = remote.tags.length;
    remote.about = remote.about + ' some additional text';
    const remoteEncoded = syncableToUint8(remote);
    const remoteDecoded = uint8ToSyncable(remoteEncoded);
    const merged = mergeDocs(syncableToDoc(baseObject), syncableToDoc(remoteDecoded));
    const newLocal = uint8ToSyncable<CollectionDetails>(merged.local);
    console.log(newLocal);
    expect(newLocal.tags.length).toEqual(3);
    expect(newLocal.contentSize).toEqual(newLocal.tags.length);
    expect(newLocal.about).toEqual(remote.about);
  });

  it('should preserve nested objects and arrays', () => {
    const obj = {
      id: 'nested',
      updated_at: new Date().toISOString(),
      meta: { author: 'Alice', version: 2 },
      tags: ['x', 'y', 'z'],
      offline: true,
      contentSize: 10,
      name: 'Deep',
    };

    const encoded = syncableToUint8(obj);
    const decoded = uint8ToSyncable<typeof obj>(encoded);

    expect(decoded).toEqual(obj);
  });

  it('should merge two docs correctly', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const map1 = doc1.getMap('content');
    const map2 = doc2.getMap('content');

    map1.set('root', new Y.Map([['name', 'A']]));
    map2.set('root', new Y.Map([['name', 'B']]));

    const { local, remote } = mergeDocs(doc1, doc2);

    const mergedLocal = uint8ToSyncable<any>(local);
    const mergedRemote = uint8ToSyncable<any>(remote);

    expect(mergedLocal).toBeDefined();
    expect(mergedRemote).toBeDefined();
  });

  it('should encode and decode JSONB-compatible array', () => {
    const encoded = syncableToUint8(baseObject);
    const jsonb = encodeDocToJSONB(encoded);
    const restored = decodeUintFromJSONB(jsonb);

    expect(restored).toBeInstanceOf(Uint8Array);
    expect(restored).toEqual(encoded);
  });

  it('should handle long text conversion via Y.Text', () => {
    const longText = 'a'.repeat(128);
    const obj = {
      id: 'longtext',
      updated_at: new Date().toISOString(),
      name: longText,
      tags: [],
      contentSize: 0,
      offline: false,
    };

    const encoded = syncableToUint8(obj);
    const decoded = uint8ToSyncable<typeof obj>(encoded);

    expect(decoded.name).toBe(longText);
  });
});

function runMergeTest<T extends Syncable>(label: string, base: T, mutateRemote: (remote: T) => void) {
  it(`should merge ${label} correctly`, () => {
    const baseEncoded = syncableToUint8(base);
    const remoteCopy = uint8ToSyncable<T>(baseEncoded);

    // simulation de modification côté remote
    mutateRemote(remoteCopy);

    const remoteEncoded = syncableToUint8(remoteCopy);
    const merged = mergeDocs(syncableToDoc(base), uint8toDoc(remoteEncoded));
    const newLocal = uint8ToSyncable<T>(merged.local);

    // validation : le merge doit refléter les changements du remote
    expect(newLocal).toEqual(remoteCopy);
  });
}

//
// === TESTS DE MERGE ===
//
describe('Yjs Syncable merge behavior', () => {
  //
  // --- 1. CollectionDetails ---
  //
  runMergeTest<CollectionDetails>(
    'CollectionDetails',
    {
      id: uuid(),
      updated_at: now(),
      name: 'Base Collection',
      about: 'Initial description',
      tags: ['math', 'science'],
      contentSize: 2,
      offline: false,
    },
    (remote) => {
      remote.tags.push('ai');
      remote.about = remote.about + ' updated';
      remote.contentSize = remote.tags.length;
      remote.name = 'Updated Collection';
    }
  );

  //
  // --- 2. Annotation ---
  //
  runMergeTest<Annotation>(
    'Annotation',
    {
      id: uuid(),
      updated_at: now(),
      canvasId: 'canvas-001',
      collectionId: 'col-001',
      order: 1,
      partOf: 'main',
      previous: undefined,
      next: 'next-001',
    } as Annotation,
    (remote) => {
      remote.order = 2;
      remote.partOf = 'subsection';
      remote.next = 'next-002';
    }
  );

  //
  // --- 3. CollectionContent ---
  //
  runMergeTest<CollectionContent>(
    'CollectionContent',
    {
      id: uuid(),
      updated_at: now(),
      content: [
        {
          canvasId: uuid(),
          position: 1,
          manifestId: uuid(),
        },
      ],
    } as CollectionContent,
    (remote) => {
      remote.content.push({
        canvasId: uuid(),
        position: 1,
        manifestId: uuid(),
      });
      remote.content[0].position = 2;
    }
  );

  //
  // --- 4. DataModel ---
  //
  runMergeTest<DataModel>(
    'DataModel',
    {
      id: uuid(),
      updated_at: now(),
      name: 'Base Model',
      description: 'Initial version',
      prompt: 'Generate summary',
      fields: [
        {
          id: 'f1',
          name: 'age',
          type: 'number',
          color: '#00AAFF',
        },
      ],
    } as DataModel,
    (remote) => {
      remote.name = 'Model v2';
      remote.description = 'Updated schema with extra fields';
      remote.fields.push({
        id: 'f2',
        name: 'weight',
        type: 'number',
        color: '#FF3355',
      });
    }
  );

  //
  // --- 5. Nested / Deep merge scenario ---
  //
  it('should merge deeply nested structures', () => {
    const base = {
      id: uuid(),
      updated_at: now(),
      name: 'Deep Object',
      config: {
        levels: [{ id: 1, name: 'root' }],
        params: { x: 10, y: 20 },
      },
      tags: ['a', 'b'],
    };

    const baseDoc = syncableToDoc(base);
    const remote = structuredClone(base);
    remote.config.params.y = 99;
    remote.tags.push('c');

    const merged = mergeDocs(baseDoc, syncableToDoc(remote));
    const newLocal = uint8ToSyncable<typeof base>(merged.local);

    expect(newLocal.config.params.y).toBe(99);
    expect(newLocal.tags.length).toBe(3);
  });
});