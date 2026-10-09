/**
 * Long-form --help text for `cvm diagram`. The SHAPES and VALUES blocks are
 * the format's cheat sheet, and the help is its source of truth for agents:
 * diagram.help.test.ts checks them against the zod schema in
 * `@cvm/core/lib/simple-diagram`, so a field added there and not here fails CI.
 */

export const HELP = `Diagram — a tldraw drawing Matt films against, edited in the Diagram Playground.

An agent DRAFTS a Diagram here in the simple shape format — a short list of
boxes, ellipses, text, arrows, lines and icons in Matt's house style — and
Matt finishes it by hand. 'create' always makes a NEW Diagram; it never edits
one Matt may have open.

Verbs:
  create --file <path|->   WRITE. A new Diagram from a JSON file ("-" = STDIN)

THE LOOP. Write the JSON, 'create' it, READ THE PNG it prints, fix the JSON
and 'create' again until the picture is right, then hand Matt the url.

FORMAT. One JSON object:
  { "name"?: "Auth flow", "shapes": [ ...shapes ] }
"name" is the Diagram's name (default "Untitled N"). Every shape has a "type"
and an "id" you choose — letters, digits, "_" or "-", unique in the Diagram.

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

LOCAL-ONLY. The PNG is drawn by the Clip Mockup daemon's headless browser on
the author's machine, through the running Course Video Manager app
(CVM_APP_URL, default http://localhost:5173). Elsewhere 'create' is refused
before doing anything: _tag "LocalOnlyCommandError", exit 7. Stop; do not
retry.

Examples:
  cvm diagram create --file agent-loop.json
  cat agent-loop.json | cvm diagram create --file -`;

export const CREATE_HELP = `WRITE. Create a NEW Diagram from a simple-format JSON file, draw it as a PNG,
and print where to look.

  cvm diagram create --file <path|->

  --file <path|->   the Diagram as JSON (see 'cvm diagram --help' for the
                    format). "-" reads STDIN.

Output: ONE NDJSON line,
  {"id":"…","url":"http://localhost:5173/diagram-playground/…","image":"/tmp/…/….png"}
  id      the new Diagram's id.
  url     where Matt opens it in the Diagram Playground — hand him this.
  image   the PNG of what you drew: light mode, white background. READ IT
          before you hand the url over.

Order: the file is checked, then drawn, then written. Nothing is written
unless all three succeed, so a failed 'create' can simply be run again.

Exit codes:
  3  invalid input — EVERY problem at once, each naming its shape:
     an unknown type, field or icon; an arrow pointing at a missing id or at
     a line; both or neither of "from" and x1, y1; a duplicate id.
  4  the PNG could not be drawn (_tag DiagramRenderError) — usually the app
     is not running at CVM_APP_URL. Nothing is written.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram create --file agent-loop.json
  cvm diagram create --file agent-loop.json | jq -r .image
  echo '{"shapes":[{"type":"box","id":"a","x":0,"y":0,"w":200,"h":100}]}' | cvm diagram create --file -`;
