# OpenJev JavaScript SDK

JavaScript and TypeScript SDK for the **OpenJev** ecosystem.

It is wire-compatible with **both** backends that speak the `/v1/systemone` contract:

- a **self-hosted OpenJev** deployment at your own URL (default: `http://localhost:8080`), and
- the hosted **TypeSafe API** at `https://api.typesafe.ai/v1` (set `OPENJEV_BASE_URL`).

This is a rebranded fork of the official TypeSafe JavaScript SDK. The request and response
shapes (`model` + `state` + questions-as-dictionary) are unchanged, so switching between the two
backends is a matter of configuration only. See [NOTICE](NOTICE) for attribution.

## Quickstart

Install the SDK (Node.js 20 or newer):

> Not published to npm yet. Until it is, install from a clone of this repository:

```sh
git clone https://github.com/caelum0x/openjev
cd openjev/sdk/js && npm install && npm run build
# then, from your project:
npm install /path/to/openjev/sdk/js
```

Once published, this becomes `npm install @openjev/sdk`.

Provide an API key and create the client. The client reads configuration from explicit options
first, then the environment, then SDK defaults.

```ts
import { choice, OpenJevClient } from "@openjev/sdk";

const client = new OpenJevClient();
const response = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    category: choice("What is this ticket about?", {
      billing: null,
      technical: null,
      other: null,
    }),
  },
});

console.log(response.answers.category.choice);
```

Answer types are inferred from your questions. The package includes ESM, CommonJS, and TypeScript
declarations.

## Choosing a backend

The base URL and API key are configurable through constructor options **or** environment
variables. Explicit options always win over the environment.

### Against a self-hosted OpenJev deployment (default)

The default base URL is `http://localhost:8080`. Set your host and API key:

```sh
export OPENJEV_BASE_URL="https://openjev.internal.example.com"
export OPENJEV_API_KEY="your-self-hosted-key"
```

or pass options in code:

```ts
const client = new OpenJevClient({
  baseURL: "https://openjev.internal.example.com",
  apiKey: "your-self-hosted-key",
});
```

### Against the hosted TypeSafe API

Point the base URL at `https://api.typesafe.ai` and supply a TypeSafe API key:

```sh
export OPENJEV_BASE_URL="https://api.typesafe.ai"
export OPENJEV_API_KEY="sk-..."
```

The back-compat `TYPESAFE_*` variable names also work:

```sh
export TYPESAFE_BASE_URL="https://api.typesafe.ai"
export TYPESAFE_API_KEY="sk-..."
```

### Environment variables

| Purpose        | Primary variable             | Back-compat alias         | Default                    |
| -------------- | ---------------------------- | ------------------------- | -------------------------- |
| API key        | `OPENJEV_API_KEY`       | `TYPESAFE_API_KEY`        | _(required)_               |
| Base URL       | `OPENJEV_BASE_URL`      | `TYPESAFE_BASE_URL`       | `http://localhost:8080`    |
| Default model  | `OPENJEV_DEFAULT_MODEL` | `TYPESAFE_DEFAULT_MODEL`  | `otsone-latest`            |
| Log level      | `OPENJEV_LOG_LEVEL`     | `TYPESAFE_LOG_LEVEL`      | `warn`                     |

The `OPENJEV_*` names are read first. The `TYPESAFE_*` aliases are read as a back-compat
fallback so existing TypeSafe setups keep working without variable renames.

## Trust layer (OpenJev servers)

```ts
const { answers, calibration, escalation } = await client.systemOne({
  model: "auto", // local first, LLM only for low-confidence questions
  calibration_id: "cal_...", // confidence fitted on your own labels
  state: "Where is my order?",
  questions: {
    intent: { ...choice("What does the customer want?", { refund: null, status: null }), abstain: true },
  },
});
if (answers.intent.abstained) console.log("out of scope:", answers.intent.ood);

// Shadow mode: compare with your production LLM (or human labels) without changing production.
await client.shadow.run({ state, questions, calibration_id: "cal_...", incumbent: { kind: "label", answers: { intent: "status" } } });
const summary = await client.shadow.summary({ days: 7 });
```

## Documentation

See the SDK's [client](src/client.ts) and [types](src/types.ts) for API options and defaults.
For the underlying System One contract, refer to the OpenJev host you are targeting.

## License

MIT. This project is a fork of `@typesafe-ai/sdk` (MIT); see [LICENSE](LICENSE) and [NOTICE](NOTICE).
