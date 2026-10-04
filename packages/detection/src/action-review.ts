import { randomUUID } from "node:crypto";
import { sourceId, type Assessment } from "./index.ts";
export interface ReviewedAction {
  sourceId: string;
  revision: number;
  recipient: string;
  amount: string;
  destination: string;
  message: string;
}
const fingerprint = (a: ReviewedAction) =>
  JSON.stringify([
    a.sourceId,
    a.revision,
    a.recipient,
    a.amount,
    a.destination,
    a.message,
  ]);
export class ActionReview {
  private pending:
    | {
        id: string;
        key: string;
        created: number;
        expires: number;
        approved: boolean;
      }
    | undefined;
  request(action: ReviewedAction, assessment: Assessment, now: number): string {
    this.invalidate();
    if (
      action.sourceId !== sourceId(assessment.source) ||
      action.revision !== assessment.revision ||
      !Number.isFinite(now)
    )
      throw Error("Stale action assessment");
    const id = randomUUID();
    this.pending = {
      id,
      key: fingerprint(action),
      created: now,
      expires: now + 30000,
      approved: false,
    };
    return id;
  }
  approve(reviewId: string, action: ReviewedAction, now: number): boolean {
    const p = this.pending;
    if (
      !p ||
      p.id !== reviewId ||
      p.key !== fingerprint(action) ||
      !Number.isFinite(now) ||
      now < p.created ||
      now >= p.expires
    ) {
      this.invalidate();
      return false;
    }
    p.approved = true;
    return true;
  }
  consume(action: ReviewedAction, now: number): boolean {
    const p = this.pending;
    this.invalidate();
    return (
      !!p &&
      p.approved &&
      p.key === fingerprint(action) &&
      Number.isFinite(now) &&
      now >= p.created &&
      now < p.expires
    );
  }
  invalidate(): void {
    this.pending = undefined;
  }
}
