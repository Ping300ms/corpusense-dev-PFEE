/* eslint-disable */
import * as Y from "yjs";
import { Syncable } from "@/data/models/Syncable.ts";
import { Doc } from 'yjs';

/**
 * Convert Syncable → CRDT
 */
export function syncableToUint8<T extends Syncable>(obj: T): Uint8Array {
  const doc = new Y.Doc();
  const map = doc.getMap<any>("content");

  map.set("id", obj.id);
  map.set("updated_at", obj.updated_at);
  Object.entries(obj).forEach(([k, v]) => {
    if (k !== "synced") map.set(k, v);
  });

  return Y.encodeStateAsUpdateV2(doc);
}

/**
 * Convert CRDT → Syncable
 */
export function uint8ToSyncable<T extends Syncable>(update: Uint8Array): T {
  const doc = uint8toDoc(update);

  const map = doc.getMap<any>("content");
  const obj: any = {};

  map.forEach((v, k) => {
    obj[k] = v;
  });
  
  return obj as T;
}

export function uint8toDoc(arr: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, arr);
  return doc;
}

/**
 * Merge two CRDT docs
 */
export function mergeDocs(localDoc: Doc, remoteDoc: Doc) {
  let local = Y.encodeStateAsUpdateV2(localDoc)
  let remote = Y.encodeStateAsUpdateV2(remoteDoc)

  const stateVector1 = Y.encodeStateVectorFromUpdateV2(local)
  const stateVector2 = Y.encodeStateVectorFromUpdateV2(remote)
  const diff1 = Y.diffUpdateV2(local, stateVector2)
  const diff2 = Y.diffUpdateV2(remote, stateVector1)

  // sync clients
  local = Y.mergeUpdatesV2([local, diff2])
  remote = Y.mergeUpdatesV2([remote, diff1])

  return { local: Y.encodeStateAsUpdateV2(localDoc), remote: Y.encodeStateAsUpdateV2(remoteDoc)};
}

export function encodeDocToJSONB(update: Uint8Array): number[] {
  return Array.from(update);
}

export function decodeDocFromJSONB(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}
