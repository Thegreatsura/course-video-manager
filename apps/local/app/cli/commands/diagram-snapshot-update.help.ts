/**
 * Long-form --help text for `cvm diagram snapshot update`, kept beside
 * diagram.help.ts (which is near the per-file token budget).
 */

export const SNAPSHOT_UPDATE_HELP = `WRITE. Redraw ONE DiagramSnapshot in place, to fix a layout bug (an icon too
close to a heading, a label touching its box edge, text running past a dashed
box) without adding a near-copy. Its id, its Diagram, its place in the
timeline and its Preserved mark stay; only the drawing changes. It is drawn as
a PNG, and the command prints where to look.

  cvm diagram snapshot update --file <path|-> <snapshotId>

  <snapshotId>      the DiagramSnapshot ('get' lists them).
  --file <path|->   the drawing as JSON, { "shapes": [...] }, exactly as for
                    'snapshot add'. "-" reads STDIN.

The drawing is applied ONTO THE SNAPSHOT (not the head), by the same rules as
'snapshot add': start from 'cvm diagram get --snapshot <snapshotId> <diagramId>'
and change only what you mean to.

A FILMED snapshot is REFUSED: one a Clip that is not archived pins (the
"filmed" of 'cvm diagram list'). What was on camera must stay what Matt sees
when he goes back to that Clip. 'snapshot add' a fixed drawing instead.

If the Diagram's head showed the old drawing, it now shows the new one; if
Matt has it open, the playground reloads it or offers "Reload".

UNDO. The output carries the drawing it replaced, in "previous". Save it, and
'snapshot update' it back if the fix was wrong:
  cvm diagram snapshot update --file fix.json 9c41… | jq '.previous' > undo.json
  cvm diagram snapshot update --file undo.json 9c41…
A shape the fix REMOVED comes back in Matt's defaults, and an "other" it
removed cannot come back, so prefer moving shapes to deleting them.

Output: ONE NDJSON line,
  {"snapshotId":"…","image":"/tmp/…/….png","changed":true,"headMoved":false,"previous":{"shapes":[…]}}
  snapshotId  the snapshot, unchanged.
  image       the PNG of the new drawing: <snapshotId>.png. READ IT.
  changed     false when the file drew what the snapshot already held.
  headMoved   true when the head showed the old drawing and now shows this.
  previous    the drawing it held before, as a --file to undo with.

Order: the snapshot is looked up, the file checked and applied onto it, the
drawing drawn, then written. Nothing is written unless all succeed.

Exit codes:
  2  no snapshot with that id (_tag NotFoundError).
  3  invalid input, as for 'snapshot add'; or REFUSED: the snapshot was
     filmed, another snapshot of the Diagram already draws exactly this, or
     it changed while the command ran. Nothing is written.
  4  the PNG could not be drawn (_tag DiagramRenderError). Nothing is written.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram snapshot update --file fixed.json 9c41…
  cvm diagram get --snapshot 9c41… 3f2a… | jq '{shapes}' > fixed.json`;
