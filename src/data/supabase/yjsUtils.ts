/* eslint-disable */ // shut c'est magic
import * as Y from "yjs";
import { Syncable } from "@/data/models/Syncable.ts";

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

  return Y.encodeStateAsUpdate(doc);
}

/**
 * Convert CRDT → Syncable
 */
export function uint8ToSyncable<T extends Syncable>(update: Uint8Array): T {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);

  const map = doc.getMap<any>("content");
  const obj: any = {};

  map.forEach((v, k) => {
    obj[k] = v;
  });
  
  const res = obj as T;
  res.synced = true;
  
  return res;
}

/**
 * Merge two CRDT docs
 */
export function mergeUint8(local: Uint8Array, remote: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  const l = new Y.Doc();
  const r = new Y.Doc();

  Y.applyUpdate(l, local);
  Y.applyUpdate(r, remote);

  const lUpdate = Y.encodeStateAsUpdate(l);
  const rUpdate = Y.encodeStateAsUpdate(r);

  Y.applyUpdate(doc, lUpdate);
  Y.applyUpdate(doc, rUpdate);

  return Y.encodeStateAsUpdate(doc);
}

export function encodeDocToJSONB(update: Uint8Array): number[] {
  return Array.from(update);
}

export function decodeDocFromJSONB(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}
