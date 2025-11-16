import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel.ts';

export type SyncableObject = Annotation | CollectionContent | CollectionDetails | DataModel;

export type SyncableObjectNames = "annotations" | "collections" | "collectionContents" | "models";

export const SyncableTables : SyncableObjectNames[] = [
  "collections",
  "collectionContents",
  "annotations",
  "models"
];