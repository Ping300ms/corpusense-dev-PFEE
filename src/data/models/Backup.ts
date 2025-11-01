export default interface Backup {
  id?: string;
  user_id: string;
  object_id: string;
  object_type: string;
  content: number[];
  updated_at: string;
  change_id: string;
  deleted_at: string | null;
}