import assert from "node:assert/strict";
import test from "node:test";
import { captureDeliveryFailure } from "../src/delivery_error_service.js";
import type { ErrorTracker } from "../src/infrai_error_client.js";

test("captures a redacted delivery exception before handing off to grouping", async () => {
  const calls: string[] = [];
  let capturedException = "";
  let key = "";
  const tracker: ErrorTracker = {
    async capture(exception, idempotencyKey) {
      calls.push("capture");
      capturedException = exception;
      key = idempotencyKey;
      return { event_id: "evt_test" };
    },
    async groups() {
      calls.push("groups");
      return [{ error_group_id: "grp_test" }];
    },
  };

  const result = await captureDeliveryFailure({
    reportId: "123e4567-e89b-12d3-a456-426614174000",
    creatorId: "creator-private-7",
    subscriberId: "patient-like-subscriber-9",
    assetId: "nutrition-plan-3",
    stage: "signed_download",
    error: "subscriber patient-like-subscriber-9 could not receive nutrition-plan-3",
  }, tracker);

  assert.deepEqual(calls, ["capture", "groups"]);
  assert.equal(key, result.reportId);
  assert.equal(result.state, "captured_and_grouped");
  assert.doesNotMatch(capturedException, /patient-like-subscriber-9|nutrition-plan-3|creator-private-7/);
  assert.match(capturedException, /\[redacted\]/);
});
