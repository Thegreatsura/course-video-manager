/** Long-form --help text for `cvm diagram list` and `cvm diagram component`. */

export const LIST_HELP = `READ. List Matt's Diagrams, most recently edited first — to see what he has
drawn before you draw one. Writes nothing.

  cvm diagram list [--archived] [<query>]

  <query>      only Diagrams whose NAME or WORDS match: the Diagram
               Playground's own search ("search all Diagrams by content"),
               over each Diagram's name, its head and its snapshots. Words
               match as Postgres full-text search does (stemmed, so "agents"
               finds "agent"); the name matches as a substring.
  --archived   include archived (deleted) Diagrams, each with "archived".
               A query never finds an archived Diagram.

Output: NDJSON, one line per Diagram (an empty list prints nothing),
  {"id":"…","name":"…","snapshotCount":3,"filmed":true,"url":"…"}
  id             the Diagram's id; 'cvm diagram get <id>' prints its drawings.
  name           its name.
  snapshotCount  how many snapshots are on its timeline.
  filmed         true when a Clip pins one of its snapshots: Matt filmed
                 against it, so it is his real house style.
  url            where Matt opens it in the Diagram Playground.

With a query, each line also says what matched, and the order is the
search's (most recently filmed or edited first):
  "matched": {"name":true,"head":"…words…","snapshots":[{"id":"…","text":"…words…"}]}
  name       the query is in the Diagram's name.
  head       the words around the match on its current drawing, if they matched.
  snapshots  each snapshot whose words matched, with the words around the
             match; 'cvm diagram get --snapshot <id> <diagramId>' prints it.

To copy a drawing: 'cvm diagram get --snapshot <snapshotId> <diagramId>'
prints its shapes in the format 'create' and 'snapshot add' take.

Examples:
  cvm diagram list
  cvm diagram list agent
  cvm diagram list "context window" | jq -r '.matched.snapshots[].id'
  cvm diagram list | jq -r 'select(.filmed) | .id + "\\t" + .name'`;

export const COMPONENT_HELP = `A Component: a named piece of a drawing Matt saved in the Diagram Playground
to drop into any Diagram. It belongs to no Diagram, and it never changes.

Verbs:
  list   READ. Every Component, with its shapes in the simple format

Saving, renaming and deleting a Component happen in the playground only.
See 'cvm diagram component list --help'.`;

export const COMPONENT_LIST_HELP = `READ. List Matt's Components, most recently used first, each with its shapes
in the SAME simple shape format 'cvm diagram create' and 'snapshot add' take
— a worked example of his house style to copy from. Writes nothing (it does
not count as using a Component).

  cvm diagram component list

Output: NDJSON, one line per Component (an empty list prints nothing),
  {"id":"…","name":"…","shapes":[{"type":"box","id":"…","x":…}, …]}
  id      the Component's id.
  name    its name.
  shapes  its drawing, back to front. x and y are where Matt drew it, not
          from 0: shift them all to place it. A shape the format cannot say
          comes back as {"type":"other","id":"…"} — leave it out of a copy.

Every run mints FRESH ids for every Component's shapes (each arrow's
"from"/"to" follows them), so a copy never collides with the Diagram it came
from or with anything already drawn: paste its shapes into 'create' or
'snapshot add' as they are. For a SECOND copy of the same Component, run
'component list' again — two copies from one run share ids and are refused
as duplicates.

Examples:
  cvm diagram component list
  cvm diagram component list | jq -c '{name, shapes}'
  cvm diagram component list | jq 'select(.name | test("loop"; "i")) | .shapes'`;
