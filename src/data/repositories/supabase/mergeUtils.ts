import { SyncableObject, SyncableObjectName } from '@/data/models/Syncable.ts';
import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel';
import isEqual from 'lodash/isEqual';
import { CollectionElement } from '@/data/models/CollectionElement.ts';

type MergeParameters<T> = {
  newLocal: T,
  localDate: Date,
  remote: T,
  remoteDate: Date,
  oldLocal: T | null,
}

function getMergeParamValues<T, K>(param: MergeParameters<T>, field: keyof T): MergeParameters<K> {
  return {
    newLocal: param.newLocal[field],
    remote: param.remote[field],
    oldLocal: param.oldLocal == null ? null : param.oldLocal[field],
    localDate: param.localDate,
    remoteDate: param.remoteDate,
  } as MergeParameters<K>;
}

// Last-Write-Wins
function LWW<T>(local: T, remote: T, localDate: Date, remoteDate: Date): T {
  return localDate.getTime() >= remoteDate.getTime() ? local : remote;
}

function mergeString(param: MergeParameters<string>): string {
  // small strings => LWW
  if ((param.newLocal.length ?? 0) <= 36)
    return LWW(param.newLocal, param.remote, param.localDate, param.remoteDate);

  const oldLines = (param.oldLocal ?? "").split("\n");
  const remoteLines = param.remote.split("\n");
  const localLines = param.newLocal.split("\n");

  const maxLen = Math.max(oldLines.length, remoteLines.length, localLines.length);

  const result: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] ?? "";
    const remoteLine = remoteLines[i] ?? "";
    const localLine = localLines[i] ?? "";

    const remoteChanged = !isEqual(oldLine, remoteLine);
    const localChanged = !isEqual(oldLine, localLine);

    // Aucun changement -> garder la ligne telle quelle
    if (!remoteChanged && !localChanged) {
      result.push(oldLine);
      continue;
    }

    // Un seul côté a changé → on prend celui-là
    if (remoteChanged && !localChanged) {
      result.push(remoteLine);
      continue;
    }
    if (!remoteChanged && localChanged) {
      result.push(localLine);
      continue;
    }

    // Conflit : les deux ont changé différemment
    if (!isEqual(remoteLine, localLine)) {
      result.push(
        "<<<<<<< REMOTE",
        remoteLine,
        "=======",
        localLine,
        ">>>>>>> LOCAL"
      );
      continue;
    }

    // Les deux ont changé de la même manière → identique
    result.push(remoteLine);
  }

  return result.join("\n");
}

function mergeValue<T>(param: MergeParameters<T>): T {
  if (isEqual(param.oldLocal, param.remote)) return param.newLocal;
  if (param.newLocal === undefined) return param.remote;
  if (param.remote === undefined) return param.newLocal;

  if (typeof param.newLocal === 'string' && typeof param.remote === 'string')
    return mergeString(param as MergeParameters<string>) as T;

  return LWW(param.newLocal, param.remote, param.localDate, param.remoteDate);
}

function mergeStringArray(param: MergeParameters<string[]>): string[] {
  const old = new Set<string>(param.oldLocal);
  const local = new Set<string>(param.newLocal);
  const result = new Set(param.remote);

  // delete : if in old local and not in new local => deletion
  for (const oldItem of old) if (!local.has(oldItem)) result.delete(oldItem);

  for (const localItem of param.newLocal) result.add(localItem);
  return [...result.values()];
}

function mergeObjectArray<T extends { id: string }>(param: MergeParameters<T[]>): T[] {
  const oldMap = new Map<string, T>(param.oldLocal?.map(i => [i.id, i]));
  const newMap = new Map<string, T>(param.newLocal.map(i => [i.id, i]));
  const result = new Map<string, T>(param.remote.map(i => [i.id, i]));

  // delete : if in old local and not in new local => deletion
  for (const [id] of oldMap) {
    if (!newMap.has(id)) {
      result.delete(id);
    }
  }

  for (const localItem of param.newLocal) {
    const remoteItem = result.get(localItem.id);
    if (isEqual(localItem, remoteItem)) continue;
    if (remoteItem === undefined) {
      // entirely new local entry -> append
      result.set(localItem.id, localItem);
      continue;
    }

    // replace remote element in-place in result with LWW
    result.set(localItem.id, LWW(localItem, remoteItem, param.localDate, param.remoteDate));
  }

  return [...result.values()];
}

function compositeKey(e: CollectionElement): string {
  return e.canvasId + e.manifestId;
}

function mergeCollectionElements(
  param: MergeParameters<CollectionElement[]>
): CollectionElement[] {
  const { oldLocal, newLocal, remote } = param;

  const result = new Map<string, CollectionElement>(
    remote.map(e => [compositeKey(e), e])
  );

  // deleted objects
  if (oldLocal !== null) {
    const newKeys = new Set(newLocal.map(e => compositeKey(e)));
    for (const old of oldLocal) {
      const key = compositeKey(old);
      if (!newKeys.has(key)) result.delete(key);
    }
  }

  // inserted objects
  for (const local of newLocal) {
    const key = compositeKey(local);
    if (!result.has(key)) result.set(key, local);
  }

  const finalList = [...result.values()].sort((a, b) => a.position - b.position);
  finalList.forEach((e, i) => (e.position = i));

  return finalList;
}


function mergeCollectionDetails(param: MergeParameters<CollectionDetails>): CollectionDetails {
  return {
    id: param.newLocal.id,
    name: mergeValue(getMergeParamValues(param, 'name')),
    about: mergeValue(getMergeParamValues(param, 'about')),
    tags: mergeStringArray(getMergeParamValues(param, 'tags')),
    modelId: mergeValue(getMergeParamValues(param, 'modelId')),
    contentSize: param.remote.contentSize, // computed after collection Content merge
    offline: mergeValue(getMergeParamValues(param, 'offline')),
  };
}

function mergeCollectionContent(param: MergeParameters<CollectionContent>): CollectionContent {
  return {
    id: param.newLocal.id,
    content: mergeCollectionElements(getMergeParamValues(param, 'content')),
  };
}

function mergeDataModels(param: MergeParameters<DataModel>): DataModel {
  return {
    id: param.newLocal.id,
    description: mergeValue(getMergeParamValues(param, 'description')),
    fields: mergeObjectArray(getMergeParamValues(param, 'fields')),
    name: mergeValue(getMergeParamValues(param, 'name')),
    prompt: mergeValue(getMergeParamValues(param, 'prompt')),
  };
}

function mergeAnnotation(param: MergeParameters<Annotation>): Annotation {
  const { oldLocal, newLocal, remote } = param;
  return {
    id: newLocal.id,
    bodies: mergeObjectArray(getMergeParamValues(param, 'bodies')),
    canvasId: mergeValue(getMergeParamValues(param, 'canvasId')),
    collectionId: mergeValue(getMergeParamValues(param, 'collectionId')),
    next: mergeValue(getMergeParamValues(param, 'next')),
    partOf: mergeValue(getMergeParamValues(param, 'partOf')),
    previous: mergeValue(getMergeParamValues(param, 'previous')),
    target: mergeValue(getMergeParamValues(param, 'target')),
    order: oldLocal !== null && oldLocal.order === remote.order ? newLocal.order : remote.order,
  };
}

export function merge(
  newLocal: SyncableObject,
  localDate: Date,
  remote: SyncableObject,
  remoteDate: Date,
  type: SyncableObjectName,
  oldLocal: SyncableObject | null = null,
): SyncableObject {
  const param = { newLocal, localDate, remote, remoteDate, oldLocal };

  switch (type) {
    case 'annotations':
      return mergeAnnotation(param as MergeParameters<Annotation>);
    case 'collections':
      return mergeCollectionDetails(param as MergeParameters<CollectionDetails>);
    case 'collectionContents':
      return mergeCollectionContent(param as MergeParameters<CollectionContent>);
    case 'models':
      return mergeDataModels(param as MergeParameters<DataModel>);
  }
}