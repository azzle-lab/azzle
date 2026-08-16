# V2 conformance checklist

An integration conforms when it:

- uses Base 8453 and addresses from the V2 manifest at runtime;
- uses lower-camel V2 keys and AZL wei for all protocol liabilities;
- models only the V2 states and methods in `TaskRegistryV2`;
- distinguishes gateway deposit funding from job escrow funding;
- checks gateway/staking/oracle live status;
- treats USD figures as oracle-priced policy targets;
- discovers and indexes V2 events without V1 subgraph mixing;
- treats public scope as one-time publication and private content as untrusted;
- uses deterministic bonded arbitration and its timeout, not party-selected tiers;
- labels derived reputation scores as offchain policy;
- contains no copied deployment addresses.

Contracts win on behavior; the manifest wins on deployment configuration.
