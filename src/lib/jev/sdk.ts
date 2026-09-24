import type {
  ChoiceQuestion,
  EntryType,
  NoulQuestion,
  ScoreQuestion,
  SystemOneRequest,
  SystemOneResponse,
} from "./types";

export function noul(
  instructions: EntryType,
  criteria?: { true?: EntryType; false?: EntryType },
): NoulQuestion {
  return { type: "noul", instructions, criteria };
}

export function choice(
  instructions: EntryType,
  criteria: Record<string, EntryType>,
): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

export function score(instructions: EntryType, criteria: EntryType[]): ScoreQuestion {
  return { type: "score", instructions, criteria };
}

export class TypeSafeClient {
  apiKey: string;
  baseURL: string;
  model: string;

  constructor(opts?: { apiKey?: string; baseURL?: string; model?: string }) {
    this.apiKey = opts?.apiKey ?? "";
    this.baseURL = (opts?.baseURL ?? "/api/v1").replace(/\/$/, "");
    this.model = opts?.model ?? "system-one";
  }

  async systemOne(
    req: Omit<SystemOneRequest, "model"> & { model?: string },
  ): Promise<SystemOneResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.baseURL}/systemone`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: req.model ?? this.model,
        state: req.state,
        questions: req.questions,
      }),
    });
    const body = (await res.json()) as SystemOneResponse | { error: { message: string } };
    if (!res.ok) {
      const msg =
        "error" in body && body.error?.message
          ? body.error.message
          : `TypeSafe error ${res.status}`;
      throw new Error(msg);
    }
    return body as SystemOneResponse;
  }
}
