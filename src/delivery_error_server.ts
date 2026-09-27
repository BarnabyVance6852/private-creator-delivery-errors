import { createServer } from "node:http";
import { ZodError } from "zod";
import { captureDeliveryFailure, deliveryFailureSchema } from "./delivery_error_service.js";
import { InfraiError, InfraiErrorClient } from "./infrai_error_client.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const tracker = new InfraiErrorClient(apiKey);
const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/delivery-errors") {
    return send(response, 404, { error: "route_not_found" });
  }

  try {
    const input = deliveryFailureSchema.parse(await readJson(request));
    const receipt = await captureDeliveryFailure(input, tracker);
    return send(response, 202, receipt);
  } catch (error) {
    if (error instanceof ZodError) {
      return send(response, 400, { error: "invalid_request", issues: error.issues });
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.code, message: error.message });
    }
    return send(response, 502, { error: "upstream_transport_error" });
  }
}).listen(port, () => console.log(`Delivery error intake listening on http://localhost:${port}`));

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
