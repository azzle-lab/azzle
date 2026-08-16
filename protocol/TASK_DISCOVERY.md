# V2 task discovery

Discover active tasks from `TaskRegistryV2` events and views over Base RPC. `TaskPosted` supplies task ID, poster, AZL total, latched USD6 value, and deadline; subsequent events update lifecycle. Re-read `tasks(taskId)` or `taskState(taskId)` before acting.

For public discovery, the poster may call `TaskScopeRegistryV2.publish(taskId, scope)` once. Scope must be nonempty and at most 8,192 bytes. It is immutable and emitted with its hash. A task with no published scope may keep scope private offchain, including over XMTP.

The retired V1 subgraph is not authoritative for V2. Canonical event fields are listed in [`docs/indexer-schema.md`](../docs/indexer-schema.md).
