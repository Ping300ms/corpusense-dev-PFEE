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
export function uint8ToSyncable<T extends Syncable>(update: Uint8Array | string): T {
  const arr = typeof update === "string" ? hexStringToUint8Array(update) : update;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, arr);

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

function hexStringToUint8Array(hex: string): Uint8Array {
  if (hex.startsWith("\\x")) hex = hex.slice(2);
  const len = hex.length / 2;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = parseInt(hex.substr(i*2, 2), 16);
  return arr;
}
