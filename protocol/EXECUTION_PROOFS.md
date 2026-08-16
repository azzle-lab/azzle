# V2 delivery evidence

V2 does not have an onchain submit-proof or review state. The worker calls `markDelivered`, which records only a timestamp and never moves escrow. Artifacts, receipts, and evidence may be exchanged offchain and committed by hash when opening or updating a dispute. Applications must not describe offchain verification as contract-enforced payment authorization.
