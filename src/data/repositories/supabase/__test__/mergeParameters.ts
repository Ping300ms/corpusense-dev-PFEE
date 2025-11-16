export type MergeParameters<T> = {
  newLocal : T,
  localDate : Date,
  remote : T,
  remoteDate : Date,
  oldLocal : T | null,
}