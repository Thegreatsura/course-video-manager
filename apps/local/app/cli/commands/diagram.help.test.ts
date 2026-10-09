import { describe, expect, it } from "vitest";
import {
  COLORS,
  DASHES,
  DEFAULTS,
  FILLS,
  HEADS,
  SHAPE_SCHEMAS,
  SHAPE_TYPES,
  SIZES,
} from "@cvm/core/lib/simple-diagram/index";
import { ICON_NAMES } from "@cvm/lucide-icons";
import { CREATE_HELP, HELP } from "./diagram.help";
import { parseCreateInput } from "./diagram-input";

// ===========================================================================
// The help IS the format's documentation for agents, and the zod schema is
// what the command enforces. These tests hold the two together: a shape type,
// field, optional mark, enum value or default that changes in one and not the
// other fails here, so an agent is never taught a format the command refuses.
// ===========================================================================

/** The lines of one help block, from its heading to the next blank line. */
const block = (heading: string): string[] => {
  const lines = HELP.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  expect(start, `the help has a ${heading} block`).toBeGreaterThan(-1);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    body.push(line);
  }
  return body;
};

/** `  box      id, x, y, w?` -> ["box", "id, x, y, w?"] */
const row = (line: string) => {
  const match = line.match(/^ {2}(\S+)\s{2,}(.+)$/);
  expect(match, `"${line}" is a "  <name>  <values>" row`).not.toBeNull();
  return [match![1]!, match![2]!] as const;
};

/** What the help documents for each shape type: field -> optional? */
const documentedShapes = () =>
  new Map(
    block("SHAPES").map((line) => {
      const [type, rest] = row(line);
      // A trailing "(...)" is a note, not a field.
      const fields = rest
        .replace(/\s{2,}\(.*\)$/, "")
        .split(/[,|]/)
        .map((field) => field.trim())
        .filter(Boolean);
      return [
        type,
        new Map(
          fields.map((field) => [field.replace(/\?$/, ""), field.endsWith("?")])
        ),
      ] as const;
    })
  );

describe("cvm diagram --help documents the simple shape format exactly", () => {
  it("lists every shape type the schema has, and no other", () => {
    expect([...documentedShapes().keys()].sort()).toEqual(
      [...SHAPE_TYPES].sort()
    );
  });

  it.each(SHAPE_TYPES.map((type) => [type]))(
    "documents every field of %s, with the schema's optional marks",
    (type) => {
      const documented = documentedShapes().get(type)!;
      const shape = SHAPE_SCHEMAS[type].shape as Record<
        string,
        { safeParse: (value: unknown) => { success: boolean } }
      >;
      const schemaFields = new Map(
        Object.entries(shape)
          .filter(([field]) => field !== "type")
          .map(([field, schema]) => [
            field,
            schema.safeParse(undefined).success,
          ])
      );
      expect(Object.fromEntries(documented)).toEqual(
        Object.fromEntries(schemaFields)
      );
    }
  );

  it.each([
    ["color", COLORS, DEFAULTS.color],
    ["fill", FILLS, DEFAULTS.fill],
    ["dash", DASHES, DEFAULTS.dash],
    ["size", SIZES, DEFAULTS.size],
    ["heads", HEADS, DEFAULTS.heads],
  ] as const)(
    "lists every %s value and marks the default",
    (name, values, fallback) => {
      const line = block("VALUES").find((l) => row(l)[0] === name);
      expect(line, `VALUES has a ${name} row`).toBeDefined();
      const listed = row(line!)[1]
        .split(",")
        .map((v) => v.trim());
      expect(listed.map((v) => v.replace(/ \(default\)$/, ""))).toEqual([
        ...values,
      ]);
      expect(listed.filter((v) => v.endsWith(" (default)"))).toEqual([
        `${fallback} (default)`,
      ]);
    }
  );

  it("explains every field it lists, in words or as a VALUES row", () => {
    const explained = [
      ...block("WHAT THE FIELDS MEAN"),
      ...block("VALUES"),
    ].join("\n");
    const fields = new Set(
      [...documentedShapes().values()].flatMap((fields) => [...fields.keys()])
    );
    for (const field of fields) {
      if (field === "id") continue; // explained under FORMAT
      expect(explained, `"${field}" is explained`).toMatch(
        new RegExp(`(^|[\\s,])${field}([\\s,]|$)`, "m")
      );
    }
  });
});

/** The JSON object under the help's EXAMPLE heading. */
const example = (): { name: string; shapes: unknown[] } => {
  const lines = HELP.split("\n");
  const start = lines.findIndex((line) => line === "EXAMPLE");
  const end = lines.findIndex((line, i) => i > start && line === "  }");
  return JSON.parse(lines.slice(start + 1, end + 1).join("\n"));
};

describe("cvm diagram --help documents what 'create' accepts", () => {
  const icons = new Set<string>(ICON_NAMES);

  it("documents one drawing AND a batch of snapshots", () => {
    const format = block("FORMAT").join("\n");
    expect(format).toContain('"shapes": [');
    expect(format).toContain('"snapshots": [ { "shapes": [...] }');
  });

  it("gives an EXAMPLE that 'create' accepts as one snapshot", () => {
    const parsed = parseCreateInput(example(), icons);
    expect(parsed.ok && parsed.scenes).toHaveLength(1);
  });

  it("accepts the EXAMPLE's shapes as a batch, one snapshot per entry", () => {
    const { name, shapes } = example();
    const parsed = parseCreateInput(
      { name, snapshots: [{ shapes: shapes.slice(0, 2) }, { shapes }] },
      icons
    );
    expect(parsed.ok && parsed.scenes).toHaveLength(2);
  });

  it("documents the output 'create' prints: id, url and snapshots of {id, image}", () => {
    const output = CREATE_HELP.slice(CREATE_HELP.indexOf("Output:"));
    expect(output).toMatch(
      /\{"id":"…","url":"[^"]+",\s+"snapshots":\[\{"id":"…","image":"[^"]+"\}/
    );
    for (const field of ["id", "url", "snapshots", "image"]) {
      expect(output).toMatch(new RegExp(`^ {2,4}${field} `, "m"));
    }
  });
});
