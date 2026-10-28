# Flow definitions API

The flow definition API stores editable graph drafts inside Carteio's existing workspace authorization boundary. It uses the existing session cookie and `AuthSessionGuard`; no provider credentials are accepted or stored.

## Routes

- `GET /workspaces/:slug/flows?assistantId=<uuid>` lists flows visible to workspace members.
- `GET /workspaces/:slug/flows/:flowId` loads a flow visible to workspace members.
- `POST /workspaces/:slug/flows` creates a flow; owners/admins only.
- `PATCH /workspaces/:slug/flows/:flowId` updates its name or graph with a required `expectedVersion`; owners/admins only. A stale version returns `409 FLOW_VERSION_CONFLICT` so one editor cannot silently overwrite another editor's save.
- `DELETE /workspaces/:slug/flows/:flowId` deletes one saved flow; owners/admins only.
- `POST /workspaces/:slug/flows/:flowId/run` executes a saved flow; owners/admins only.

Every lookup is filtered by the organization resolved from the caller's active membership. Creation checks that the linked assistant belongs to the same organization and is not archived. Delete uses the same organization scope, returns not found for records outside it, and writes an audit event in the same database transaction. The database relation also ties assistant and organization IDs together.

## Graph version 1

```json
{
  "version": 1,
  "nodes": [
    { "id": "start", "kind": "start", "title": "Chat Input", "detail": "Receive a message", "x": 100, "y": 110 },
    { "id": "assistant", "kind": "assistant", "title": "Carteio Assistant", "detail": "Configured provider and retrieval", "x": 390, "y": 110 },
    { "id": "response", "kind": "response", "title": "AI Response", "detail": "Return the answer", "x": 680, "y": 110 }
  ],
  "edges": [["start", "assistant"], ["assistant", "response"]]
}
```

Allowed node kinds are `start`, `transform`, `assistant`, `condition`, and `response`. A transform node requires a 1–2000 character `promptTemplate`; each `{{input}}` token is replaced with the current value. Resulting character and UTF-8 byte lengths are calculated before substitution so an expansion over the assistant request limits is rejected without allocating the expanded string. An assistant node may include an `assistantId`; it must identify a non-archived assistant in the same workspace. If omitted, the flow's connected assistant is used. An If / Else node requires `conditionOperator` (`contains`, `equals`, or `starts_with`) and a non-empty `conditionValue`. Comparisons normalize Unicode, trim whitespace, and ignore letter case. Its first outgoing edge is True and its second is False; the editor exposes separate output controls and requires the True connection first. The API bounds node/edge counts and graph size, checks unique IDs and valid edge endpoints, requires exactly one `start` node, and rejects cyclic graphs. A runnable graph has exactly one Chat Input, at least one Carteio Assistant, and one or more AI Response leaves. All branches must be reachable, each route must run an assistant before a response, and branches cannot merge. A selected branch runs in graph order and passes its current value to the next node. Each assistant call delegates provider selection, RAG retrieval, conversation persistence, and response safety to Carteio's existing assistant pipeline. Per-node deterministic turn IDs make retries idempotent for assistant calls. Loops and arbitrary code, URL, SQL, provider credential, or tool execution settings are not supported.

Successful run responses include `assistantReply` (the last raw assistant response), `assistantRuns` (node ID, assistant ID, reply, session/message IDs, and provider/model for each assistant step), `reply` (the final value after later templates), `responseNodeId`, aggregated knowledge sources, provider/model and usage metadata for the last assistant, request-scoped step status/duration records in graph order, and `skippedNodeIds` for nodes on unselected branches. Condition steps include a `branch` string set to `"true"` or `"false"`. Output templates affect the flow result; each assistant conversation transcript retains that assistant's raw response. Run records and traces are not persisted. The browser can abort the request; the controller propagates disconnect cancellation to the assistant provider adapter. Provider adapters currently return completed responses and do not stream tokens.

## Migration state and execution gap

`FlowDefinition` and the additive SQL migration are in source. The migration has not been run, so the API cannot persist or execute saved definitions until the user approves and applies it. Live graph runs delegate their assistant node to the existing assistant conversation service.

## Local flow files

The builder exports a CARTEIO flow envelope containing version, name, and graph JSON. It also accepts that envelope or a raw version-1 graph. Imports are limited to 200 KB, 100 nodes, and 250 edges; node types, IDs, labels, coordinates, template bounds, and edge references are checked before the local draft is replaced. The target assistant association is selected in the builder and is not imported, so local files do not carry workspace credentials or assistant authorization. The server remains authoritative when the draft is saved. The editor runs a matching topology check and shows the first reason a draft cannot run while leaving draft save available when the graph passes API structural validation.

Connections are created by selecting a node output and then a destination input port. Paths show direction and can be removed by clicking the path or focusing it and pressing Delete/Backspace. Nodes expose visible input/output ports. These editor affordances edit the graph only; the API validator still determines whether the resulting draft can run.

The canvas zoom control supports 20–150% zoom and computes a fit scale from the current node extents and viewport. Drag deltas are converted back to graph coordinates at the active zoom level.


## Knowledge Search node

`knowledge` is an executable graph node with optional `knowledgeLimit` (integer 1–10; defaults to 5). It accepts an optional workspace `assistantId` and runs the existing authenticated internal preview for that assistant (falling back to the flow-level assistant) and returns `knowledgeRuns` containing query, retrieval mode, eligible source count, and bounded result content with source title, URL, locator, and score. It uses the existing permission filtered retrieval service. Results are diagnostic trace output and do not alter the message passed forward or get injected into the assistant prompt.
