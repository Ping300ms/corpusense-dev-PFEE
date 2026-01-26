import { SyncableObject } from '@/data/models/Syncable.ts';
import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel';
import isEqual from 'lodash/isEqual';
import { CollectionElement } from '@/data/models/CollectionElement.ts';
import { SyncPendingOperation } from '@/data/models/SyncPendingOperation.ts';
import Backup from '@/data/models/Backup.ts';

/**
 * Parameters required to perform a three-way merge between local and remote states.
 */
type MergeParameters<T> = {
  /** The current state on the local device after changes */
  newLocal: T,
  /** The timestamp when the local change occurred */
  localDate: Date,
  /** The state currently stored on the remote server */
  remote: T,
  /** The timestamp of the last update on the remote server */
  remoteDate: Date,
  /** The original state before the local changes were made (the common ancestor) */
  oldLocal: T | null,
}

/**
 * Extracts a specific field from the merge parameters to create a new parameter set for that field.
 * Useful for recursive merging of nested objects.
 */
function getMergeParamValues<T, K>(param: MergeParameters<T>, field: keyof T): MergeParameters<K> {
  return {
    newLocal: param.newLocal[field],
    remote: param.remote[field],
    oldLocal: param.oldLocal == null ? null : param.oldLocal[field],
    localDate: param.localDate,
    remoteDate: param.remoteDate,
  } as MergeParameters<K>;
}

/**
 * Last-Write-Wins (LWW) resolution strategy.
 * Compares timestamps and returns the most recent version of the data.
 */
function LWW<T>(local: T, remote: T, localDate: Date, remoteDate: Date): T {
  return localDate.getTime() >= remoteDate.getTime() ? local : remote;
}

/**
 * Merges two strings. Uses LWW for short strings (like IDs or short titles)
 * and a line-by-line Three-Way Merge for longer content to preserve concurrent edits.
 * * In case of conflicting changes on the same line, Git-style conflict markers are inserted.
 */
function mergeString(param: MergeParameters<string>): string {
  // small strings (e.g., UUIDs or short names) => Use Last-Write-Wins
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

    // No changes from either side -> keep the original line
    if (!remoteChanged && !localChanged) {
      result.push(oldLine);
      continue;
    }

    // Only remote changed -> take remote version
    if (remoteChanged && !localChanged) {
      result.push(remoteLine);
      continue;
    }
    // Only local changed -> take local version
    if (!remoteChanged && localChanged) {
      result.push(localLine);
      continue;
    }

    // Conflict: both sides changed the same line differently
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

    // Both changed in the exact same way -> identical result
    result.push(remoteLine);
  }

  return result.join("\n");
}

/**
 * Generic value merger. Decides between LWW or specialized string merging
 * depending on the data type.
 */
function mergeValue<T>(param: MergeParameters<T>): T {
  if (isEqual(param.oldLocal, param.remote)) return param.newLocal;
  if (param.newLocal === undefined) return param.remote;
  if (param.remote === undefined) return param.newLocal;

  if (typeof param.newLocal === 'string' && typeof param.remote === 'string')
    return mergeString(param as MergeParameters<string>) as T;

  return LWW(param.newLocal, param.remote, param.localDate, param.remoteDate);
}

/**
 * Merges arrays of strings (e.g., tags).
 * Handles additions and deletions by comparing against the base state (oldLocal).
 */
function mergeStringArray(param: MergeParameters<string[]>): string[] {
  const old = new Set<string>(param.oldLocal);
  const local = new Set<string>(param.newLocal);
  const result = new Set(param.remote);

  // Deletion logic: if it existed in old state but is gone in new local, remove it from remote
  for (const oldItem of old) if (!local.has(oldItem)) result.delete(oldItem);

  // Addition logic: add all current local items
  for (const localItem of param.newLocal) result.add(localItem);
  return [...result.values()];
}

/**
 * Merges arrays of objects that have an 'id' property.
 * Synchronizes list content and resolves conflicts on individual items using LWW.
 */
function mergeObjectArray<T extends { id: string }>(param: MergeParameters<T[]>): T[] {
  const oldMap = new Map<string, T>(param.oldLocal?.map(i => [i.id, i]));
  const newMap = new Map<string, T>(param.newLocal.map(i => [i.id, i]));
  const result = new Map<string, T>(param.remote.map(i => [i.id, i]));

  // Handle deletions
  for (const [id] of oldMap) {
    if (!newMap.has(id)) {
      result.delete(id);
    }
  }

  // Handle additions and updates
  for (const localItem of param.newLocal) {
    const remoteItem = result.get(localItem.id);
    if (isEqual(localItem, remoteItem)) continue;
    if (remoteItem === undefined) {
      // Entirely new entry from local -> append to result
      result.set(localItem.id, localItem);
      continue;
    }

    // Existing entry on both sides -> resolve conflict with LWW
    result.set(localItem.id, LWW(localItem, remoteItem, param.localDate, param.remoteDate));
  }

  return [...result.values()];
}

/**
 * Generates a unique key for a collection element based on its canvas and manifest.
 */
function compositeKey(e: CollectionElement): string {
  return e.canvasId + e.manifestId;
}

/**
 * Specialized merge for CollectionElements.
 * Synchronizes additions/deletions and recalculates positions to ensure a continuous sequence.
 */
function mergeCollectionElements(
  param: MergeParameters<CollectionElement[]>
): CollectionElement[] {
  const { oldLocal, newLocal, remote } = param;

  const result = new Map<string, CollectionElement>(
    remote.map(e => [compositeKey(e), e])
  );

  // Remove deleted objects
  if (oldLocal !== null) {
    const newKeys = new Set(newLocal.map(e => compositeKey(e)));
    for (const old of oldLocal) {
      const key = compositeKey(old);
      if (!newKeys.has(key)) result.delete(key);
    }
  }

  // Insert new objects
  for (const local of newLocal) {
    const key = compositeKey(local);
    if (!result.has(key)) result.set(key, local);
  }

  // Sort by position and normalize the position values (0, 1, 2...)
  const finalList = [...result.values()].sort((a, b) => a.position - b.position);
  finalList.forEach((e, i) => (e.position = i));

  return finalList;
}

/**
 * Merges metadata for a Collection (name, description, tags, etc.).
 */
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

/**
 * Merges the actual items within a collection.
 */
function mergeCollectionContent(param: MergeParameters<CollectionContent>): CollectionContent {
  return {
    id: param.newLocal.id,
    content: mergeCollectionElements(getMergeParamValues(param, 'content')),
  };
}

/**
 * Merges DataModel definitions, including custom fields.
 */
function mergeDataModels(param: MergeParameters<DataModel>): DataModel {
  return {
    id: param.newLocal.id,
    description: mergeValue(getMergeParamValues(param, 'description')),
    fields: mergeObjectArray(getMergeParamValues(param, 'fields')),
    name: mergeValue(getMergeParamValues(param, 'name')),
    prompt: mergeValue(getMergeParamValues(param, 'prompt')),
  };
}

/**
 * Merges an Annotation and its associated bodies.
 * Special logic is applied to the 'order' field to prevent local sorting from overwriting remote sorting unless specified.
 */
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
    // Custom logic for order: favor remote unless local was specifically updated
    order: oldLocal !== null && oldLocal.order === remote.order ? newLocal.order : remote.order,
  };
}

/**
 * Main entry point for merging local changes with remote backup data.
 * Dispatches the merge logic based on the specific database table affected.
 * @param change Object containing the new state and the previous local state.
 * @param remote The current state from the remote backup.
 * @param operation The pending sync operation containing metadata like the table name and date.
 * @returns The merged SyncableObject ready to be saved.
 */
export function merge(
  change: {newObj: SyncableObject, oldObj: SyncableObject},
  remote: Backup,
  operation: SyncPendingOperation,
): SyncableObject {
  const param = {
    newLocal: change.newObj,
    localDate: operation.date,
    remote: remote.content,
    remoteDate: new Date(remote.updated_at),
    oldLocal: change.oldObj,
  };

  switch (operation.table) {
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