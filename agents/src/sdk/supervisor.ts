/**
 * Supervisor agents review a worker delivery on behalf of the poster and only
 * escalate to the human for a co-sign once the work appears complete.
 */
export type SupervisorRole = "poster-supervisor" | "human" | "byo";

export interface SupervisorReview {
  complete: boolean;
  gaps: string[];
  recommend: "approve" | "request-revision" | "open-dispute" | "escalate-human";
  summary: string;
}

export interface Supervisor {
  id: string;
  role: SupervisorRole;
  review(input: {
    scope: string;
    delivery: string;
    receiptHash: string;
    criteria?: unknown;
  }): Promise<SupervisorReview>;
}

export function staticSupervisor(gapsFrom: (input: { scope: string; delivery: string }) => string[]): Supervisor {
  return {
    id: "static-supervisor",
    role: "poster-supervisor",
    async review(input) {
      const gaps = gapsFrom(input);
      return {
        complete: gaps.length === 0,
        gaps,
        recommend: gaps.length === 0 ? "approve" : "request-revision",
        summary: gaps.length === 0 ? "Delivery covers the public scope." : gaps.join(" "),
      };
    },
  };
}
