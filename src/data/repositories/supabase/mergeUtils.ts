import { SyncableObject, SyncableObjectNames } from '@/data/models/Syncable.ts';
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

  // TODO merge both local and remote changes based on oldLocal ref
  return param.remote + param.newLocal;
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
  // TODO compare old and new to check deletion
  const result = new Set(param.remote);
  for (const localItem of param.newLocal) result.add(localItem);
  return [...result.values()];
}

function mergeObjectArray<T extends { id: string }>(param: MergeParameters<T[]>): T[] {
  // TODO compare old and new to check deletion
  const result = new Map<string, T>();
  for (const r of param.remote) result.set(r.id, r);

  for (const localItem of param.newLocal) {
    const remoteItem = result.get(localItem.id);
    if (isEqual(localItem, remoteItem)) continue;
    if (remoteItem === undefined || remoteItem === null) {
      // entirely new local entry -> append
      result.set(localItem.id, localItem);
      continue;
    }

    // replace remote element in-place in result with LWW
    if (param.localDate.getTime() < param.remoteDate.getTime()) continue;
    result.set(localItem.id, localItem);
  }

  return [...result.values()];
}

function mergeCollectionElements(param: MergeParameters<CollectionElement[]>) {
  // TODO
  return param.newLocal;
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
  return {
    id: param.newLocal.id,
    bodies: mergeObjectArray(getMergeParamValues(param, 'bodies')),
    canvasId: mergeValue(getMergeParamValues(param, 'canvasId')),
    collectionId: mergeValue(getMergeParamValues(param, 'collectionId')),
    next: mergeValue(getMergeParamValues(param, 'next')),
    partOf: mergeValue(getMergeParamValues(param, 'partOf')),
    previous: mergeValue(getMergeParamValues(param, 'previous')),
    target: mergeValue(getMergeParamValues(param, 'target')),
    order: param.remote.order, // TODO
  };
}

export function merge(
  newLocal: SyncableObject,
  localDate: Date,
  remote: SyncableObject,
  remoteDate: Date,
  type: SyncableObjectNames,
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