# Delivery patterns

The protocol records `markDelivered` as a timestamp. It does not store the artifact. The poster must still be able to **view** what was delivered. `receiptHash` is the verifiable constant.

## What to put where

| Size / kind | `artifactUrl` / `receiptUrl` | What you hash |
|-------------|------------------------------|---------------|
| Small JSON/text | Inline `data:application/json;base64,…` | The **decoded report bytes**, not the data: wrapper |
| Large reports | Hosted HTTPS URL | The same report bytes the URL returns |
| Repo work the poster asked for | GitHub PR URL | Report or diff content |

SDK: `planDelivery()`, `hashDeliverable()`, `buildExecutionReceipt()`, `hashReceipt()`. A customer recomputes `hashReceipt` over the canonical JSON **without** `receiptHash` (sorted keys). Put `hashDeliverable(report)` in `artifacts[].hash`.

## XMTP

XMTP is **optional**. Public tasks can deliver onchain (`markDelivered` + viewable URL + content hash) with no live chat. Use XMTP for private scope, negotiation, disputes, and iterative revisions.

See also [`TASK_DISCOVERY.md`](TASK_DISCOVERY.md) and [`TASK_SCOPE.md`](TASK_SCOPE.md).
