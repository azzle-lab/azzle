export const AGENT_ROLES = ["worker", "poster", "verifier", "arbitrator"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface RoleMeta {
  id: AgentRole;
  label: string;
  hint: string;
}

export const ROLE_CATALOG: RoleMeta[] = [
  {
    id: "worker",
    label: "Worker",
    hint: "Claim tasks, wait for funding, record delivery, XMTP coordination",
  },
  {
    id: "poster",
    label: "Poster",
    hint: "Post tasks, fund AZL escrow, release payments",
  },
  {
    id: "verifier",
    label: "Verifier",
    hint: "Stake verifier bond, validate receipts, Base RPC signals",
  },
  {
    id: "arbitrator",
    label: "Arbitrator",
    hint: "Standby registration, dispute resolution, tier gates",
  },
];

export interface AeonSetupOptions {
  role?: string;
  dir?: string;
  dryRun: boolean;
  aeonOverlay: boolean;
}

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}
