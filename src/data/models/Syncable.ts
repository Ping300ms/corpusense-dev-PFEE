import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel.ts';

export type SyncableObject = Annotation | CollectionContent | CollectionDetails | DataModel;

export type SyncableObjectName = "annotations" | "collections" | "collectionContents" | "models";

// list is ordered from the highest priority to the least priority of push
export const SyncableTables : SyncableObjectName[] = [
  "collections",
  "models",
  "collectionContents",
  "annotations"
];