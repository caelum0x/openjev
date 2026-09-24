import type { APIPromise } from "../api-promise";
import type { Transport } from "../client";
import { OpenJevError } from "../errors";
import { validateQuestions } from "../questions";
import type {
  Questions,
  RequestOptions,
  ShadowRequest,
  ShadowResult,
  ShadowSummary,
  ShadowSummaryQuery,
} from "../types";

/**
 * Shadow mode: run OpenJev next to your production LLM (or human labels) on the
 * same traffic and log agreement, without changing what production serves.
 */
export class Shadow {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Compare OpenJev's answers with the incumbent's for one request.
   * Send `incumbent.answers` from your production LLM (no extra spend), or
   * `incumbent: { kind: "label", answers }` for human ground truth. Pass
   * `calibration_id` to apply a calibration and feed its drift monitor.
   */
  run<const Q extends Questions>(
    request: ShadowRequest<Q>,
    options: RequestOptions = {},
  ): APIPromise<ShadowResult<Q>> {
    validateQuestions(request.questions);
    const body = { ...request, model: request.model ?? this.#transport.defaultModel };
    return this.#transport
      .request<DataWire<ShadowResult<Q>>>("POST", "/v1/shadow", { ...options, body })
      .map((wire) => unwrap(wire, "POST /v1/shadow"));
  }

  /** Aggregated agreement, confidence bands and projected savings. */
  summary(query: ShadowSummaryQuery = {}, options: RequestOptions = {}): APIPromise<ShadowSummary> {
    const params = new URLSearchParams();
    if (query.days !== undefined) params.set("days", String(query.days));
    if (query.threshold !== undefined) params.set("threshold", String(query.threshold));
    if (query.incumbent !== undefined) params.set("incumbent", query.incumbent);
    const qs = params.toString();
    return this.#transport
      .request<DataWire<ShadowSummary>>("GET", `/v1/shadow${qs ? `?${qs}` : ""}`, options)
      .map((wire) => unwrap(wire, "GET /v1/shadow"));
  }
}

type DataWire<T> = { data: T };

const unwrap = <T>(wire: DataWire<T>, route: string): T => {
  if (wire && typeof wire === "object" && "data" in wire && wire.data != null) return wire.data;
  throw new OpenJevError(`Unexpected response shape from ${route}; expected { data: ... }.`);
};
