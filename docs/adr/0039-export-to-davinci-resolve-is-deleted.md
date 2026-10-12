---
status: accepted
---

# Export to DaVinci Resolve is deleted

Decided by Matt on #2100. Supersedes point 4 of [ADR 0036](0036-a-clips-recorder-is-its-own.md).

## Context

**Export to DaVinci Resolve** built a DaVinci timeline from a Video's Clips by running a Lua script through `fuscript.exe`. It handed DaVinci one Footage file per Clip, so it refused any Video holding a CVM-recorder Clip (`davinciResolveRefusal`): that Clip's picture is a composite of a Recording Session's camera, screen and mic files, drawn at export. Recording is moving to the CVM recorder, so the export covered fewer Videos every week, and Matt doesn't use it.

## Decision

Delete it: the route, the Video menu entry and the editor's pending spinner, `sendClipsToDavinciResolve` and the `fuscript.exe` runner, the Lua scripts under `apps/local/resources/resolve/`, and `davinciResolveRefusal`.

## Consequences

- No schema change: nothing in the database belonged to the export.
- CVM's own export (and its **Export Hash**) is the only way out of the editor.
- Bringing DaVinci back would mean compositing CVM-recorder Clips first, a new design rather than a revert.
