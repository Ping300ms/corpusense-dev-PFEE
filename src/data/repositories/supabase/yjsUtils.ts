/* eslint-disable */
import * as Y from "yjs";
import { Doc } from 'yjs';
import { SyncableObject } from '@/data/models/Syncable.ts';

/**
 * Convert Syncable → CRDT
 */
export function syncableToUint8(obj: any): Uint8Array {
  return Y.encodeStateAsUpdateV2(syncableToDoc(obj));
}

export function syncableToDoc(obj: any): Doc {
  const doc = new Y.Doc();
  doc.getMap("content").set("root", DocBuilder(obj));
  return doc;
}

export function DocBuilder(obj: any): Y.Map<any> {
  const map = new Y.Map();

  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Y.AbstractType) {
      map.set(k, v); // déjà un type partagé
      continue;
    }

    // TODO check possible nested Arrays corner cases
    if (Array.isArray(v)) {
      const yarr = new Y.Array();
      for (const el of v) {
        if (typeof el === "object" && el !== null) yarr.push([DocBuilder(el)]);
        // TODO check possible nested long text
        else yarr.push([el]);
      }
      map.set(k, yarr);
    } else if (typeof v === "string" && v.length > 64) { // long text
      const ytext = new Y.Text();
      ytext.insert(0, v);
      map.set(k, ytext);
    } else if (v && typeof v === "object") { // nested object
      map.set(k, DocBuilder(v));
    } else { // ids ou numbers
      map.set(k, v);
    }
  }

  return map;
}

/**
 * Convert CRDT → Syncable
 */
export function uint8ToSyncable(update: Uint8Array): SyncableObject {
  return docToSyncable(uint8toDoc(update));
}

export function docToSyncable(doc: Doc): SyncableObject {
  const content = doc.getMap<any>("content");
  const rootMap = content.get("root") as Y.Map<any>;

  if (!rootMap) throw new Error("Root node not found in Y.Doc");

  return mapToObject(rootMap) as SyncableObject;
}

function mapToObject(map: Y.Map<any>): any {
  const obj: any = {};
  map.forEach((v, k) => {
    if (v instanceof Y.Text) obj[k] = v.toString();
    else if (v instanceof Y.Array) obj[k] = v.map((el: any) => {
      if (el instanceof Y.Map) return mapToObject(el);
      if (el instanceof Y.Text) return el.toString();
      return el;
    });
    else if (v instanceof Y.Map) obj[k] = mapToObject(v);
    else obj[k] = v;
  });
  return obj;
}

export function uint8toDoc(arr: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, arr);
  return doc;
}


/**
 * Merge two CRDT docs
 */
// FIXME
export function mergeDocs(local : {doc : Doc, date : Date}, remote : {doc : Doc, date : Date}) {
  let localUpdate = Y.encodeStateAsUpdateV2(local.doc);
  let remoteUpdate = Y.encodeStateAsUpdateV2(remote.doc);

  const stateVector1 = Y.encodeStateVectorFromUpdateV2(localUpdate)
  const stateVector2 = Y.encodeStateVectorFromUpdateV2(remoteUpdate)
  const diff1 = Y.diffUpdateV2(localUpdate, stateVector2)
  const diff2 = Y.diffUpdateV2(remoteUpdate, stateVector1)

  // sync clients
  localUpdate = Y.mergeUpdatesV2([localUpdate, diff2])
  remoteUpdate = Y.mergeUpdatesV2([remoteUpdate, diff1])

  // Last write wins
  // return { local: Y.encodeStateAsUpdateV2(localDoc), remote: Y.encodeStateAsUpdateV2(remoteDoc)};

  // Merge
  return { local : localUpdate, remote : remoteUpdate};
}

export function encodeDocToJSONB(update: Uint8Array): number[] {
  return Array.from(update);
}

export function decodeUintFromJSONB(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}
