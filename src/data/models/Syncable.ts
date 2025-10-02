import { WithStringId } from '@/data/models/utils.ts';

export interface Syncable extends WithStringId {
  updated_at: string // Date ISO string
  synced: boolean
}