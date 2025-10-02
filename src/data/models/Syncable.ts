import { WithStringId } from '@/data/models/utils.ts';
import { Annotation } from '@/data/models/Annotation.ts';
import { CollectionContent, CollectionDetails } from '@/data/models/Collection.ts';
import { DataModel } from '@/data/models/DataModel.ts';

export interface Syncable extends WithStringId {
  updated_at: string // Date ISO string
  synced: boolean
}

export type SyncableObject = Annotation | CollectionContent | CollectionDetails | DataModel;

export const SyncableTables: string[] = ["annotations", "collections", "collectionContents", "models"];