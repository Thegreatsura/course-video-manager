/**
 * Long-form --help text for `cvm diagram`. The SHAPES and VALUES blocks are
 * the format's cheat sheet, and the help is its source of truth for agents:
 * diagram.help.test.ts checks them against the zod schema in
 * `@cvm/core/lib/simple-diagram`, so a field added there and not here fails CI.
 */

export const HELP = `Diagram — a tldraw drawing Matt films against, edited in the Diagram Playground.

An agent DRAFTS a Diagram here in the simple shape format — a short list of
boxes, ellipses, text, arrows, lines and icons in Matt's house style — and
Matt finishes it by hand.

A Diagram is the folder; its drawings are SNAPSHOTS, and a snapshot never
changes. 'create' keeps each drawing you give it as a Preserved Snapshot, in
order, and opens the Diagram on the FIRST. A batch is a build-up: the steps
Matt walks through on camera, one snapshot each.

To CHANGE a Diagram, never edit it: 'snapshot add' a new drawing. It becomes
a Preserved Snapshot and the Diagram's current drawing (its head) — a Restore
to Head. If Matt drew on the head by hand and no snapshot holds that drawing,
it is preserved first, so nothing he did is lost.

Verbs:
  create --file <path|->                     WRITE. A new Diagram from a JSON file ("-" = STDIN)
  snapshot add --file <path|-> <diagramId>   WRITE. One more drawing, made the head
  render <snapshotId>                        READ. Draw a stored snapshot to a PNG
  get [--snapshot <snapshotId>] <diagramId>  READ. The head and the snapshots, as JSON

THE LOOP. Write the JSON, 'create' it, READ EVERY PNG it prints, fix the JSON
and 'create' again until the pictures are right, then hand Matt the url. Once
he has the url, change it with 'snapshot add', never a second 'create'. To
see what Matt has drawn since, 'get' it first.

FORMAT. One JSON object — ONE drawing:
  { "name"?: "Auth flow", "shapes": [ ...shapes ] }
or a BATCH of drawings, first to last:
  { "name"?: "Auth flow", "snapshots": [ { "shapes": [...] }, { "shapes": [...] } ] }
"name" is the Diagram's name (default "Untitled N"). Every shape has a "type"
and an "id" you choose — letters, digits, "_" or "-", unique in its drawing.
In a batch, keep a shape's id from one snapshot to the next and every
snapshot must differ from the others.

SHAPES ("?" = optional; leave a field out to get Matt's default)
  box      id, x, y, w, h, color?, fill?, dash?
  ellipse  id, x, y, w, h, color?, fill?, dash?
  text     id, x, y, text, size?, color?, rotation?
  arrow    id, from? | x1?, y1?, to? | x2?, y2?, text?, bend?, heads?, color?, dash?
  line     id, x1, y1, x2, y2, color?, dash?
  icon     id, x, y, name, color?
  other    id   (only in what a read gives back; 'create' refuses it)

WHAT THE FIELDS MEAN
  x, y       the top-left corner, in canvas pixels; y grows DOWN. A Diagram
             is filmed in a 16:9 frame: lay it out inside about 1600x900.
  w, h       a box's or ellipse's width and height (> 0).
  text       a text shape's words; "\\n" starts a new line. On an arrow, a
             label drawn on its middle.
  box text   a box or ellipse has NO text inside. Put a separate text shape
             over it, as Matt does. Text at size m is about 13px wide per
             character and 32px tall per line, so centre it by eye.
  from, to   an arrow end ATTACHED to another shape's id (box, ellipse, text
             or icon — not an arrow or line). It meets that shape's outline
             and follows it when Matt moves the shape. Give each end EITHER
             from/to OR its free point: x1, y1 for the start, x2, y2 for the
             end.
  bend       how far the arrow's middle bows sideways, in pixels (0 =
             straight; try 30 to 80; negative bows the other way).
  heads      which ends carry an arrowhead.
  rotation   degrees, clockwise — for a hand-written aside, tilt it a few.
  name       an icon's Lucide name, e.g. "database", "user", "bot",
             "search", "flag", "wrench", "code-xml". An unknown name is
             refused. Icons are 48x48.
  line       a straight two-point line: a divider or an underline.

VALUES (default marked)
  color   black (default), grey, light-violet, violet, blue, light-blue, yellow, orange, green, light-green, light-red, red, white
  fill    none (default), semi, solid, pattern, fill, lined-fill
  dash    draw (default), solid, dashed, dotted, none
  size    s, m (default), l, xl
  heads   end (default), both, none

Matt's style, already the defaults: the hand-drawn font, size m, the "draw"
dash, black, no fill. Colour is for meaning — one lit box, not a rainbow.
Keep it SMALL: about 10 shapes.

EXAMPLE
  {
    "name": "Agent loop",
    "shapes": [
      { "type": "box", "id": "agent", "x": 0, "y": 0, "w": 220, "h": 120 },
      { "type": "text", "id": "agent-label", "x": 70, "y": 44, "text": "Agent" },
      { "type": "box", "id": "tools", "x": 420, "y": 0, "w": 220, "h": 120, "color": "light-blue", "fill": "semi" },
      { "type": "text", "id": "tools-label", "x": 492, "y": 44, "text": "Tools" },
      { "type": "arrow", "id": "call", "from": "agent", "to": "tools", "text": "call", "bend": 40 },
      { "type": "arrow", "id": "result", "from": "tools", "to": "agent", "bend": 40 },
      { "type": "icon", "id": "bot", "x": 86, "y": -70, "name": "bot" },
      { "type": "line", "id": "rule", "x1": 0, "y1": 200, "x2": 640, "y2": 200, "dash": "dashed" },
      { "type": "text", "id": "aside", "x": 440, "y": 220, "text": "runs until done", "size": "s", "rotation": -5 }
    ]
  }

LOCAL-ONLY. The PNGs are drawn by the Clip Mockup daemon's headless browser on
the author's machine, through the running Course Video Manager app
(CVM_APP_URL, default http://localhost:5173). Elsewhere every verb but 'get'
is refused before doing anything: _tag "LocalOnlyCommandError", exit 7. Stop;
do not retry.

Examples:
  cvm diagram create --file agent-loop.json
  cat agent-loop.json | cvm diagram create --file -
  cvm diagram snapshot add --file agent-loop-v2.json <diagramId>
  cvm diagram render <snapshotId>
  cvm diagram get <diagramId>
  cvm diagram get --snapshot <snapshotId> <diagramId>`;

export const CREATE_HELP = `WRITE. Create a NEW Diagram from a simple-format JSON file: each drawing in it
becomes a Preserved Snapshot, in order, and the Diagram opens on the FIRST.
Each is drawn as a PNG, and the command prints where to look.

  cvm diagram create --file <path|->

  --file <path|->   the Diagram as JSON — one drawing {name?, shapes} or a
                    batch {name?, snapshots: [{shapes}, …]} (see
                    'cvm diagram --help' for the format). "-" reads STDIN.

Output: ONE NDJSON line,
  {"id":"…","url":"http://localhost:5173/diagram-playground/…",
   "snapshots":[{"id":"…","image":"/tmp/…/….png"}, …]}
  id         the new Diagram's id.
  url        where Matt opens it in the Diagram Playground — hand him this.
  snapshots  one per drawing, in the file's order; the first is what the
             Diagram shows when Matt opens it.
    id       the DiagramSnapshot's id.
    image    the PNG of that drawing: light mode, white background. READ
             EVERY ONE before you hand the url over.

Order: the file is checked, then drawn, then written. Nothing is written
unless all three succeed, so a failed 'create' can simply be run again.

Exit codes:
  3  invalid input — EVERY problem at once, each naming its shape (and, in a
     batch, its snapshot): an unknown type, field or icon; an arrow pointing
     at a missing id or at a line; both or neither of "from" and x1, y1; a
     duplicate id; both "shapes" and "snapshots"; an empty batch; two
     snapshots that draw the same thing.
  4  the PNG could not be drawn (_tag DiagramRenderError) — usually the app
     is not running at CVM_APP_URL. Nothing is written.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram create --file agent-loop.json
  cvm diagram create --file agent-loop.json | jq -r '.snapshots[].image'
  echo '{"shapes":[{"type":"box","id":"a","x":0,"y":0,"w":200,"h":100}]}' | cvm diagram create --file -`;

export const SNAPSHOT_HELP = `A Diagram's snapshots: its drawings, each one immutable.

Verbs:
  add --file <path|-> <diagramId>   WRITE. One more drawing, made the head

See 'cvm diagram snapshot add --help'.`;

export const SNAPSHOT_ADD_HELP = `WRITE. Add ONE drawing to an existing Diagram as a Preserved Snapshot and make
it the Diagram's head (a Restore to Head). This is how a Diagram changes: a
snapshot is never edited, a new one is added. It is drawn as a PNG, and the
command prints where to look.

  cvm diagram snapshot add --file <path|-> <diagramId>

  <diagramId>       the Diagram: its id, or its playground url.
  --file <path|->   the drawing as JSON, { "shapes": [...] } — no "name" (the
                    Diagram has one) and no "snapshots" (one at a time). See
                    'cvm diagram --help' for the format. "-" reads STDIN.

Nothing is lost. If no snapshot in the Diagram's timeline holds its current
drawing — Matt drew on it by hand — that drawing is preserved FIRST, then the
new one is added and restored. If Matt has the Diagram open, the playground
offers him "Reload" or "Keep my edits".

Output: ONE NDJSON line,
  {"snapshotId":"…","image":"/tmp/…/….png"}
  snapshotId  the new DiagramSnapshot's id; the Diagram's head is now this.
  image       the PNG of the drawing: light mode, white background. READ IT.

Order: the file is checked, the Diagram looked up, the drawing drawn, then
written. Nothing is written unless all succeed. Adding a drawing the Diagram
already has re-uses that snapshot.

Exit codes:
  2  no Diagram with that id (_tag NotFoundError).
  3  invalid input — EVERY problem at once, each naming its shape.
  4  the PNG could not be drawn (_tag DiagramRenderError) — usually the app
     is not running at CVM_APP_URL. Nothing is written.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram snapshot add --file agent-loop-v2.json 3f2a…
  cvm diagram snapshot add --file - 3f2a… < agent-loop-v2.json | jq -r .image`;

export const RENDER_HELP = `READ. Draw one stored DiagramSnapshot to a PNG and print where it is. It draws
a SNAPSHOT — never the head, which Matt may be mid-way through editing.

  cvm diagram render <snapshotId>

Output: ONE NDJSON line,
  {"snapshotId":"…","image":"/tmp/…/….png"}
  snapshotId  the snapshot drawn.
  image       its PNG: light mode, white background, <snapshotId>.png.

Exit codes:
  2  no snapshot with that id (_tag NotFoundError).
  4  the PNG could not be drawn (_tag DiagramRenderError) — usually the app
     is not running at CVM_APP_URL.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram render 9c41…
  cvm diagram render 9c41… | jq -r .image`;

export const GET_HELP = `READ. Print a Diagram's current drawing (its head) and its snapshots, the
drawings in the simple shape format of 'cvm diagram --help'. Writes nothing.

  cvm diagram get [--snapshot <snapshotId>] <diagramId>

  <diagramId>              the Diagram: its id, or its playground url.
  --snapshot <snapshotId>  print just this snapshot's drawing instead.

Output: ONE NDJSON line,
  {"id":"…","name":"…","url":"…","head":{"shapes":[…]},
   "snapshots":[{"id":"…","preserved":true,"clipIds":[…],"diagramText":"…","createdAt":"…"}, …]}
  id           the Diagram's id.
  name         its name.
  url          where Matt opens it in the Diagram Playground.
  head         what the Diagram shows now — Matt may have drawn on it by hand.
  snapshots    its timeline, oldest first (archived ones left out).
    id           the DiagramSnapshot's id; 'render' draws it.
    preserved    a Preserved Snapshot: kept even when no Clip pins it.
    clipIds      the Clips that pin it, filmed against this drawing.
    diagramText  every word on its shapes, in one line.
    createdAt    when it was taken.

With --snapshot, ONE NDJSON line,
  {"snapshotId":"…","shapes":[…]}
  snapshotId  the snapshot.
  shapes      its drawing.

A shape the format cannot say — a hand-drawn stroke, a sticky note, a shape
in a group or frame — comes back as {"type":"other","id":"…"}. 'create' and
'snapshot add' refuse "other", so a drawing that has one cannot be passed
back whole: tell Matt what you would change instead.

Exit codes:
  2  no Diagram with that id, or no snapshot with that id in this Diagram
     (_tag NotFoundError).

Examples:
  cvm diagram get 3f2a…
  cvm diagram get 3f2a… | jq '.head.shapes'
  cvm diagram get --snapshot 9c41… 3f2a…`;
