import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { StorageBucket } from "@/packages/storage/buckets";
import {
  createInitialStoragePageState,
  driveWarnings,
  moveTargets,
  storageCells,
  storagePageReducer,
  storageLocations,
  storageRows,
} from "./storage-page-reducer";

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const buckets: StorageBucket[] = [
  { id: "course:a", kind: "course", name: "Course A" },
  { id: "course:b", kind: "course", name: "Course B" },
  { id: "unused-footage", kind: "unused-footage", name: "Unused Footage" },
];

const start = () => {
  const listener = { stop: () => {} } as never;
  const tester = new ReducerTester(
    storagePageReducer,
    createInitialStoragePageState(() => listener)
  );
  return tester
    .send({
      type: "roots-measured",
      roots: [
        {
          root: D,
          label: "D:",
          online: true,
          totalBytes: 2000 * GB,
          freeBytes: 164 * GB,
          dirtyBit: "clean",
        },
        {
          root: E,
          label: "E:",
          online: true,
          totalBytes: 2000 * GB,
          freeBytes: 1400 * GB,
          dirtyBit: "clean",
        },
      ],
    })
    .send({ type: "buckets-listed", buckets });
};

const names = (tester: ReturnType<typeof start>) =>
  storageRows(tester.getState()).map((r) => [r.bucket.name, r.totalBytes]);

describe("storagePageReducer", () => {
  it("adds streamed sizes up into rows, largest first, re-ordering as totals arrive", () => {
    const tester = start();
    expect(storageRows(tester.getState())).toEqual([]);

    tester.send({
      type: "sizes-counted",
      sizes: [
        {
          bucketId: "course:a",
          location: D,
          kind: "footage",
          bytes: 10,
          files: 1,
        },
        {
          bucketId: "course:b",
          location: D,
          kind: "footage",
          bytes: 20,
          files: 1,
        },
      ],
    });
    expect(names(tester)).toEqual([
      ["Course B", 20],
      ["Course A", 10],
    ]);

    tester.send({
      type: "sizes-counted",
      sizes: [
        {
          bucketId: "course:a",
          location: E,
          kind: "footage",
          bytes: 15,
          files: 1,
        },
        {
          bucketId: "course:a",
          location: D,
          kind: "exported-videos",
          bytes: 5,
          files: 1,
        },
        {
          bucketId: "unused-footage",
          location: D,
          kind: "footage",
          bytes: 1,
          files: 1,
        },
      ],
    });
    expect(names(tester)).toEqual([
      ["Course A", 30],
      ["Course B", 20],
      ["Unused Footage", 1],
    ]);
    expect(storageRows(tester.getState())[0]).toMatchObject({
      byLocation: {
        [D]: { footage: 10, "exported-videos": 5, other: 0 },
        [E]: { footage: 15, "exported-videos": 0, other: 0 },
      },
      bytes: { footage: 25, "exported-videos": 5, other: 0 },
    });
  });

  it("stops listening once the scan completes, and ignores the closed stream after", () => {
    const tester = start()
      .send({
        type: "sizes-counted",
        sizes: [
          {
            bucketId: "course:a",
            location: D,
            kind: "footage",
            bytes: 10,
            files: 1,
          },
        ],
      })
      .send({ type: "scan-completed" })
      // The browser reports the stream the server closed.
      .send({
        type: "scan-failed",
        message: "The connection to the scan was lost",
      });

    expect(tester.getState()).toMatchObject({
      status: "complete",
      failure: null,
      scan: null,
    });
    expect(tester.getEffects()).toEqual([]);
    expect(tester.getExec().stop).toHaveBeenCalledTimes(1);
    expect(names(tester)).toEqual([["Course A", 10]]);
  });

  it("drops a root that turns out unreadable, and shows other locations after the roots", () => {
    const tester = start()
      .send({
        type: "sizes-counted",
        sizes: [
          {
            bucketId: "course:a",
            location: E,
            kind: "footage",
            bytes: 10,
            files: 1,
          },
          {
            bucketId: "course:a",
            location: D,
            kind: "footage",
            bytes: 3,
            files: 1,
          },
          {
            bucketId: "unused-footage",
            location: "/tmp/video-processing",
            kind: "other",
            bytes: 2,
            files: 1,
          },
        ],
      })
      .send({ type: "root-unreadable", root: E, message: "EIO" })
      .send({
        type: "sizes-counted",
        sizes: [
          {
            bucketId: "course:a",
            location: E,
            kind: "footage",
            bytes: 99,
            files: 1,
          },
        ],
      });

    expect(names(tester)).toEqual([
      ["Course A", 3],
      ["Unused Footage", 2],
    ]);
    expect(tester.getState().unreadableRoots).toEqual({ [E]: "EIO" });
    expect(storageLocations(tester.getState())).toEqual([
      D,
      E,
      "/tmp/video-processing",
    ]);
  });

  it("a failed scan says why and stops listening", () => {
    const tester = start().send({
      type: "scan-failed",
      message: "DATABASE down",
    });
    expect(tester.getState()).toMatchObject({
      status: "failed",
      failure: "DATABASE down",
    });
    expect(tester.getExec().stop).toHaveBeenCalledTimes(1);
  });
});

describe("Offline and Dirty drives", () => {
  const measured = (roots: storagePageReducer.State["roots"]) => {
    const listener = { stop: () => {} } as never;
    return new ReducerTester(
      storagePageReducer,
      createInitialStoragePageState(() => listener)
    )
      .send({ type: "roots-measured", roots: roots! })
      .send({ type: "buckets-listed", buckets });
  };

  const d = {
    root: D,
    label: "D:",
    online: true as const,
    totalBytes: 2000 * GB,
    freeBytes: 164 * GB,
    dirtyBit: "clean" as const,
  };

  it("an Offline root is warned about, reads Offline in every row, and takes no moves", () => {
    const tester = measured([
      d,
      { root: E, label: "E:", online: false, reason: "ENOENT" },
    ]).send({
      type: "sizes-counted",
      sizes: [
        {
          bucketId: "course:a",
          location: D,
          kind: "footage",
          bytes: 5 * GB,
          files: 1,
        },
      ],
    });
    const state = tester.getState();

    expect(driveWarnings(state)).toEqual({
      offline: [{ root: E, label: "E:", online: false, reason: "ENOENT" }],
      dirty: [],
    });
    const [row] = storageRows(state);
    expect(storageCells(state, row!, "footage")).toEqual([
      { location: D, type: "bytes", bytes: 5 * GB },
      { location: E, type: "offline" },
    ]);
    expect(moveTargets(state).map((t) => [t.root.root, t.refusal])).toEqual([
      [D, null],
      [E, "E: is Offline"],
    ]);
  });

  it("a Dirty root is warned about, but still counted and still a move target", () => {
    const tester = measured([
      d,
      { ...d, root: E, label: "E:", dirtyBit: "dirty" },
    ]).send({
      type: "sizes-counted",
      sizes: [
        {
          bucketId: "course:a",
          location: E,
          kind: "footage",
          bytes: 3 * GB,
          files: 1,
        },
      ],
    });
    const state = tester.getState();

    expect(driveWarnings(state).offline).toEqual([]);
    expect(driveWarnings(state).dirty.map((r) => r.root)).toEqual([E]);
    const [row] = storageRows(state);
    expect(storageCells(state, row!, "footage")).toEqual([
      { location: D, type: "bytes", bytes: 0 },
      { location: E, type: "bytes", bytes: 3 * GB },
    ]);
    expect(moveTargets(state).every((t) => t.refusal === null)).toBe(true);
  });

  it("a root whose dirty bit Windows won't give is not warned about", () => {
    const state = measured([
      d,
      { ...d, root: E, label: "E:", dirtyBit: "unknown" },
    ]).getState();

    expect(driveWarnings(state)).toEqual({ offline: [], dirty: [] });
  });
});
