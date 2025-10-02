import { Manifest } from '@iiif/presentation-3';
import { CollectionElement } from './CollectionElement';
import { Tag } from './Tag';
import { Syncable } from '@/data/models/Syncable.ts';

export type CollectionDetails = Syncable & {
  name: string;
  about?: string;
  tags: string[];
  modelId?: string;
  contentSize: number;
};

export type CollectionContent = Syncable & {
  content: CollectionElement[];
};

export type Collection = CollectionDetails & {
  content: CollectionElement[];
};

export interface ExportedCollection extends Manifest {
  tags: Tag[];
}
