import {
  DefaultColorStyle,
  DefaultDashStyle,
  createShapePropsMigrationSequence,
  createTLSchema,
  defaultShapeSchemas,
  type TLRecord,
  type TLStoreProps,
} from "@tldraw/tlschema";
import { Store, type StoreSnapshot } from "@tldraw/store";
import { T } from "@tldraw/validate";
import { describe, expect, it } from "vitest";
import { SCENE_SCHEMA, readSimpleDiagram, type Scene } from "../index.js";
import { FLOW, build, sceneWithUnknowns } from "./fixtures.js";

describe("the records load into a tldraw Store", () => {
  // `CvmIconShapeUtil.props` (apps/local/app/features/diagrams/cvm-icon-shape.tsx),
  // restated: core cannot import the app. Keep the two in step.
  const schema = createTLSchema({
    shapes: {
      ...defaultShapeSchemas,
      "cvm-icon": {
        props: {
          name: T.string,
          w: T.nonZeroNumber,
          h: T.nonZeroNumber,
          color: DefaultColorStyle,
          dash: DefaultDashStyle,
        },
        migrations: createShapePropsMigrationSequence({ sequence: [] }),
      },
    },
  });

  /** `Store` directly: `createTLStore` hangs in Node. */
  function load(scene: Scene) {
    const store = new Store<TLRecord, TLStoreProps>({
      schema,
      props: {
        defaultName: "",
        assets: {
          upload: () => Promise.reject(new Error("no assets")),
          resolve: () => null,
          remove: () => Promise.resolve(),
        },
        onMount: () => {},
      },
    } as unknown as ConstructorParameters<
      typeof Store<TLRecord, TLStoreProps>
    >[0]);
    // Validates every record against tldraw's own validators, and throws on the first bad one.
    store.loadStoreSnapshot(scene as unknown as StoreSnapshot<TLRecord>);
    return store;
  }

  it("a new scene loads, records unchanged by migration", () => {
    const scene = build(FLOW);
    const store = load(scene);
    for (const [id, rec] of Object.entries(scene.store)) {
      expect(store.get(id as never)).toEqual(rec);
    }
  });

  it("every record also passes schema validation one by one", () => {
    const scene = build(FLOW);
    const store = load(scene);
    for (const rec of Object.values(scene.store)) {
      expect(() =>
        schema.validateRecord(store, rec as never, "createRecord", null)
      ).not.toThrow();
    }
  });

  it("an updated scene loads", () => {
    const before = sceneWithUnknowns();
    const shapes = readSimpleDiagram(before.store).shapes;
    const after = build(
      {
        shapes: [
          ...shapes,
          { type: "arrow", id: "new", from: "a", to: "triangle", text: "x" },
        ],
      },
      before
    );
    expect(() => load(after)).not.toThrow();
  });

  it("the harness has teeth: a bad record does not load", () => {
    const scene = build(FLOW);
    const store = structuredClone(scene.store);
    (store["shape:client"]!.props as Record<string, unknown>).color = "pink";
    expect(() => load({ ...scene, store })).toThrow(/color/);
  });

  it("SCENE_SCHEMA is the schema the installed tldraw writes", () => {
    expect(schema.serialize()).toEqual(SCENE_SCHEMA);
  });
});
