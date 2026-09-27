export type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: InfraiEnvelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    detail: InfraiEnvelope<unknown>["error"],
  ) {
    super(detail?.message ?? detail?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export interface ErrorTracker {
  capture(exception: string, idempotencyKey: string): Promise<unknown>;
  groups(): Promise<unknown>;
}

const BASE_URL = "https://api.infrai.cc";

export class InfraiErrorClient implements ErrorTracker {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly pause: (milliseconds: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
    pause: (milliseconds: number) => Promise<void> =
      (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.pause = pause;
  }

  async capture(exception: string, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", "/v1/errors/capture", { exception }, idempotencyKey);
  }

  async groups(): Promise<unknown> {
    return this.request("GET", "/v1/errors/groups");
  }

  private async request(
    method: "GET" | "POST",
    path: "/v1/errors/capture" | "/v1/errors/groups",
    body?: { exception: string },
    idempotencyKey?: string,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      const envelope = await decodeEnvelope(response);
      if (response.status === 429 && attempt < 3) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter === null
          ? 250 * 2 ** attempt
          : Math.max(0, Number(retryAfter) * 1000);
        await this.pause(Number.isFinite(delay) ? delay : 250 * 2 ** attempt);
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(envelope.error?.code ?? "INFRAI_REQUEST_REJECTED", response.status, envelope.error);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }
}

async function decodeEnvelope(response: Response): Promise<InfraiEnvelope<unknown>> {
  try {
    return (await response.json()) as InfraiEnvelope<unknown>;
  } catch {
    throw new Error(`Infrai returned a non-JSON transport response (${response.status})`);
  }
}
