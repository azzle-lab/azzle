import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

export async function runApprovalScaffold(client) {
  const intakePaused = await client.isDepositIntakePaused();
  if (intakePaused) {
    console.warn("[approvals] AzlPaymentGateway intake is paused; deposit funding is unavailable");
  } else {
    console.log(
      "[approvals] fund AgentDepositVault through AzlPaymentGateway.fundWithUsdc or fundWithEth; " +
        "the gateway credits AZL deposits"
    );
  }
  console.log("[approvals] approve AZL → EscrowVault immediately before task funding");
}
