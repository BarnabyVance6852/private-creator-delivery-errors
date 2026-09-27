import { createHash } from "node:crypto";
import { z } from "zod";
import type { ErrorTracker } from "./infrai_error_client.js";

export const deliveryFailureSchema = z.object({
  reportId: z.string().uuid(),
  creatorId: z.string().min(1).max(128),
  subscriberId: z.string().min(1).max(128),
  assetId: z.string().min(1).max(128),
  stage: z.enum(["signed_download", "subscriber_update", "content_processing"]),
  error: z.string().min(1).max(2_000),
}).strict();

export type DeliveryFailure = z.infer<typeof deliveryFailureSchema>;

export type CaptureReceipt = {
  reportId: string;
  state: "captured_and_grouped";
  capture: unknown;
  groups: unknown;
};

export async function captureDeliveryFailure(
  input: DeliveryFailure,
  tracker: ErrorTracker,
): Promise<CaptureReceipt> {
  const subject = pseudonym(`${input.creatorId}:${input.subscriberId}`);
  const asset = pseudonym(input.assetId);
  const safeError = removeIdentifiers(input.error, [input.creatorId, input.subscriberId, input.assetId]);
  const exception = JSON.stringify({
    workflow: "creator_asset_delivery",
    stage: input.stage,
    subject,
    asset,
    error: safeError,
  });

  const capture = await tracker.capture(exception, input.reportId);
  const groups = await tracker.groups();
  return { reportId: input.reportId, state: "captured_and_grouped", capture, groups };
}

function pseudonym(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function removeIdentifiers(message: string, identifiers: string[]): string {
  return identifiers.reduce((clean, identifier) => clean.split(identifier).join("[redacted]"), message);
}
