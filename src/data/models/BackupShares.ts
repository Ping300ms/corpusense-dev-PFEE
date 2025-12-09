export enum Permissions {
  R = "R",
  RW = "RW",
  RWD = "RWD",
}

export interface BackupShares {
  id: string;
  shared_user: string;
  permission: Permissions;
  backup_id: string;
}