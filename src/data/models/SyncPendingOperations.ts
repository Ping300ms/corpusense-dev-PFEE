export interface SyncPendingOperations {
  id: string; //uuid
  type: "CREATE" | "UPDATE" | "DELETE";
  table: string; // keyof typeof db
  object_id: string;
  date: Date;
}