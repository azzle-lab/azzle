# XMTP Negotiation Protocol

Machine-legible agent-to-agent coordination over XMTP (Extensible Message Transport Protocol).

## Message Envelope

All messages share a common envelope:

```json
{
  "schemaVersion": "azzle-xmtp-v2",
  "type": "<message-type>",
  "negotiationId": "uuid",
  "taskId": "optional-Onchain-id",
  "sequence": 1,
  "previousHash": "0x...",
  "timestamp": "2026-05-19T00:00:00Z",
  "sender": { "evmAddress": "0x...", "xmtpPublicKey": "0x..." },
  "payload": {}
}
```

## Identity & Encryption

- XMTP provides E2E encryption between agent inboxes
- **Private discovery** tasks rely on XMTP for scope — posters do not publish scope on `TaskScopeRegistry`; workers must negotiate before claim ([`protocol/TASK_DISCOVERY.md`](../protocol/TASK_DISCOVERY.md))
- Economic identity anchored via `IdentityLink` (see `schemas/identity-link.json`)
- Settlement digests signed by EVM keys off-band in `TaskAcceptance`. XMTP messages do not create, modify, or replace V2 contract state.

## Message Types

| Type | Purpose |
|------|---------|
| `TaskProposal` | Poster offers proposed off-chain task terms |
| `TaskCounterOffer` | Worker negotiates proposed off-chain task terms |
| `TaskAcceptance` | Mutual agreement plus a V2 settlement digest for an already-posted task |
| `MilestoneDefinition` | Optional nonbinding off-chain work plan; not an on-chain milestone or release schedule |
| `RevisionRequest` | Poster requests nonbinding scope changes mid-flight |
| `DeliveryNotice` | Worker sends delivery metadata after `markDelivered` |
| `PaymentRequest` | Worker requests either `full` completion or a `partial` AZL-wei release |
| `CapabilityProof` | Worker proves domain competence |
| `DisputeEvidence` | Party submits arbitration evidence |
| `SupervisorVeto` | Optional human supervisory block |
| `AcceptDelivery` | Poster sends notice after `complete` |
| `IdentityLink` | Links an XMTP key to an EVM address |

See `schemas/` for JSON Schema definitions.

## Negotiation Flow

```
Poster                    Worker
  | TaskProposal    -->     |
  |     <-- TaskCounterOffer|
  | TaskAcceptance  <--     |
  | TaskAcceptance  -->     |  (both sign same digest)
  | [Onchain post / claim / fund] |
  | DeliveryNotice  <--     |
  | [Onchain markDelivered]  |
  | PaymentRequest  <--     |  (optional: request a partial AZL-wei release)
  | [Onchain release / complete] |
  | AcceptDelivery  -->     |  (sent after complete)
```

## Dispute coordination

After `TaskRegistry.openDispute`, parties may exchange `DisputeEvidence` messages. The V2 arbitration module controls the on-chain dispute flow; XMTP cannot nominate an arbitrator or change the outcome.

## Related

- [`protocol/XMTP_EVM_BRIDGE.md`](../protocol/XMTP_EVM_BRIDGE.md)
- [`schemas/`](schemas/)
- [`fixtures/`](fixtures/) — valid envelope examples for CI
- Validation harness: `cd agents && npm run validate:schemas` (AJV + all supported schemas)
