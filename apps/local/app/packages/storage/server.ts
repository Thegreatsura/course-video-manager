// Entry point (server) for the storage package: finding a stored path on disk.
//
// A root-relative path is looked for on each Storage Root in order and the
// first root that has it wins, so a file mid-move (on both drives) is read
// from the first. Not found anywhere fails with `StorageFileNotFoundError`,
// whose message names the roots that are offline ("E: offline?").
export {
  StorageFileNotFoundError,
  findStoragePath,
  findStoragePathSync,
  resolveStoragePath,
} from "./lib/resolve";
