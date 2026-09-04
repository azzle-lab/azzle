import { ethers } from "ethers";

export type DeliveryMode = "inline" | "hosted" | "github";

/** Keep inline data: URIs comfortable for XMTP / UI; larger reports should be hosted. */
export const INLINE_ARTIFACT_MAX_BYTES = 12_000;

export interface DeliveryPlan {
  mode: DeliveryMode;
  /** Unconstrained string stored offchain / in DeliveryNotice.receiptUrl. */
  artifactUrl: string;
  /** Content that `hashReceipt` / `hashDeliverable` should cover. */
  content: string;
  note: string;
}

/**
 * Choose how to present an artifact. The protocol only requires that the poster
 * can view the work and that receiptHash is independently recomputable.
 *
 * - Small JSON/text → `data:application/json;base64,...` (reference worker)
 * - Large reports → hosted `artifactUrl`
 * - Repo work → GitHub PR URL when that is what the poster asked for
 */
export function planDelivery(params: {
  content: string | Uint8Array;
  hostedUrl?: string;
  githubPrUrl?: string;
  mime?: string;
}): DeliveryPlan {
  const bytes = typeof params.content === "string" ? ethers.toUtf8Bytes(params.content) : params.content;
  const text = typeof params.content === "string" ? params.content : ethers.toUtf8String(params.content);
  if (params.githubPrUrl) {
    return {
      mode: "github",
      artifactUrl: params.githubPrUrl,
      content: text,
      note: "GitHub PR link for the poster; hash the report or diff content, not the URL.",
    };
  }
  if (params.hostedUrl || bytes.length > INLINE_ARTIFACT_MAX_BYTES) {
    if (!params.hostedUrl) {
      throw new Error(
        `Deliverable is ${bytes.length} bytes; host it and pass hostedUrl (inline data: URIs are for payloads under ${INLINE_ARTIFACT_MAX_BYTES} bytes).`,
      );
    }
    return {
      mode: "hosted",
      artifactUrl: params.hostedUrl,
      content: text,
      note: "Hosted artifactUrl for the poster; receiptHash still covers the content bytes.",
    };
  }
  const mime = params.mime ?? "application/json";
  const artifactUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  return {
    mode: "inline",
    artifactUrl,
    content: text,
    note: "Inline data: URI. Hash the decoded content, not the data: wrapper.",
  };
}

/** Canonical hash of deliverable bytes. Customers recompute this independently of where the file lives. */
export function hashDeliverable(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? ethers.toUtf8Bytes(content) : content;
  return ethers.keccak256(bytes);
}

export function sha256Hex(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? ethers.toUtf8Bytes(content) : content;
  return ethers.sha256(bytes);
}
