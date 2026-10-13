import type { Effect } from "effect";

/**
 * A Windows volume's dirty bit, as Windows reports it: `dirty` means the
 * volume was not cleanly unmounted (or has errors) and wants chkdsk; such a
 * drive must not be trusted with the only copy of anything. `unknown` when
 * the root is not a Windows drive, or Windows would not say (it needs an
 * elevated prompt for some queries).
 */
export type VolumeDirtyBit = "dirty" | "clean" | "unknown";

/**
 * Reads a Storage Root's dirty bit. Only ever QUERIES: nothing it runs may
 * write to, schedule a check of, or otherwise change a volume. Tests use a
 * fake; the Storage page uses {@link windowsDirtyBitReader}.
 */
export type DirtyBitReader = (root: string) => Effect.Effect<VolumeDirtyBit>;

/** The Windows drive a WSL root is on (`/mnt/e` → `E:`), or null. */
export const windowsDriveOf = (root: string): string | null => {
  const drive = /^\/mnt\/([a-z])(\/|$)/.exec(root);
  return drive ? `${drive[1]!.toUpperCase()}:` : null;
};

/**
 * What a read-only Windows dirty-bit query printed, as a {@link VolumeDirtyBit}.
 * `fsutil dirty query E:` prints "Volume - E: is NOT Dirty" / "... is Dirty";
 * `chkntfs E:` prints "E: is not dirty." / "E: is dirty. ...". Anything else
 * (access denied, an unknown drive) is `unknown`.
 */
export const parseDirtyQueryOutput = (output: string): VolumeDirtyBit => {
  if (/\bis\s+not\s+dirty\b/i.test(output)) return "clean";
  if (/\bis\s+dirty\b/i.test(output)) return "dirty";
  return "unknown";
};
