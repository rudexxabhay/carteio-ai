# Carteio Agent Builder connections report

## A. Existing limitation

The canvas previously supported only click-to-connect with a single pending source. It rejected fan-out and merge edges, had no temporary pointer wire, no selected-edge state, and no endpoint reconnection. Removing an edge immediately deleted it. Condition True/False meaning was implicit in each source node's edge order.

The frontend Flow DTO and backend graph contract store edges only as `[sourceId, targetId]` tuples. They do not persist edge IDs, handle IDs, or branch labels. Condition branches are interpreted by tuple order: first outgoing edge is True, second is False.

## B. Files changed

- `frontend/src/dashboard-source/ChatflowBuilder.tsx`
- `frontend/src/dashboard-source/chatflow-builder.css`
- `frontend/src/tests/chatflow-builder.test.tsx`

No backend, database, DTO, environment, or business-logic files were changed.

## C–D. Drag connections and rewiring

Dragging an output handle previews a Bézier wire, highlights eligible handles, and commits when released over an input. Empty-canvas release and Escape cancel. Pointer coordinates are translated through the current canvas pan and zoom. The existing keyboard click-to-connect interaction remains available.

Selecting an edge reveals draggable source and target endpoints plus a visible remove action. Target rewiring drops on an input; source rewiring drops on another output. Invalid attempts keep the old edge and show a reason. Edge selection/deletion supports keyboard focus and Delete/Backspace. Edge edits use the existing undo/redo history.

## E–F. Branches, topology, and validation

Condition outputs have separate True/False handles and remain ordered as the Flow API expects. Non-condition outputs may fan out and inputs may receive multiple edges so users can edit and save those graph shapes. Since the current runner cannot execute those shapes, merged paths, fan-out, incomplete branches, unreachable nodes, cycles, and other unsupported topologies show a clear non-runnable message; Live Bot Test is blocked until the graph is runnable. The UI prevents duplicate edges, self-connections, connections into Start, invalid node references, cycles, and malformed API graph limits/settings.

New nodes are placed to the right of the selected/rightmost node by default, keeping the flow's main direction on the X axis. Existing positions are retained; users can still move nodes freely.

## G. Persistence compatibility

Saved edges continue to serialize as the existing `[sourceId, targetId]` tuples. Existing flows load without migration. The current API cannot persist stable edge IDs, source/target handle IDs, or explicit branch metadata; the UI derives selection identity from each unique source/target pair and derives condition labels from edge order. This is the exact persistence limitation; no backend schema was invented.

The inspected runner allows only one incoming edge per node, exactly one outgoing edge from non-condition steps, exactly two outgoing edges from each condition, separate non-merging branches, no cycles, and a response after an assistant on each path. Graphs outside those execution rules can still be edited and saved when accepted by the graph DTO, but cannot be run.

## H. Undo/redo

Create, remove, source-rewire, and target-rewire operations go through the existing graph edit history, so Undo/Redo restores edge tuples along with node state. Deleting a node continues to delete its incident edges in one graph edit.

## I. Tests

The focused frontend test file now contains 48 cases, including drag/cancel, endpoint rewiring, edge deletion, multi-input/output topology warnings, condition branch order, pan/zoom, node movement geometry, duplicate/cycle rejection, keyboard controls, tuple save/reload compatibility, and blocking runner calls for non-runnable graphs. Tests were added but not executed, as requested. No build or server was run.

## J. Unsupported execution and metadata

The backend runner does not support merge/fan-out execution and the edge DTO has no persisted IDs or handle/branch fields. These are surfaced as non-runnable states or documented contract limits; no fake execution or persistence behavior was added.

## K. Manual browser verification

Open `/workspace/:slug/builder`, drag a node output to another node input, select the edge and rewire each endpoint, then remove it and use Undo/Redo. Try an extra incoming/outgoing connection and confirm the graph remains editable while the execution warning blocks Live Bot Test. Use Fit first and repeat a connection drag to check it at a changed zoom/pan. Confirm the starter condition branches still read True/False and move nodes to see the edges follow.

## Classification

**FRONTEND_PARTIAL** — source and regression coverage are implemented, but runtime/browser validation was not performed.
