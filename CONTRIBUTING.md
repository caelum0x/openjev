# Contributing to OpenJev

Thanks for your interest in OpenJev. Bug reports, fixes, new public datasets for the
leaderboard, engine improvements, docs and SDKs for more languages are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Security problems: do not open a public issue. Follow [SECURITY.md](./SECURITY.md).
- By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Development setup

Requirements: Node.js 22+, npm. Python 3.11+ and [uv](https://docs.astral.sh/uv/) only if
you work on `otsone/`, `sdk/python/` or `adapters/python/`. Docker is optional.

```bash
git clone https://github.com/caelum0x/openjev && cd openjev
npm install
npm run embed-download      # optional: the gte-small model for the embedding engine
npm run dev                 # http://localhost:8080
```

No API keys, database or model weights are needed to run the server or the tests.
Copy `.env.example` to `.env` only for the optional integrations it documents.

## Checks to run before opening a pull request

| Area you changed | Command |
|------------------|---------|
| server / console (`src/`) | `npm test && npm run gold && npm run typecheck && npm run lint` |
| native engine (`engine/`) | `make -C engine` |
| `sdk/js` | `cd sdk/js && npm install && npm test` |
| `sdk/js-lite` | `cd sdk/js-lite && npm test` |
| `sdk/python` | `cd sdk/python && uv sync && uv run pytest` |
| `adapters/python` | `cd adapters/python && uv sync && uv run pytest` |
| `skills` | `cd skills && npm test` |
| `otsone` | `cd otsone && uv sync --extra dev && uv run pytest` |

If you change the engine's scoring, also run `npm run leaderboard` and include the
before/after numbers in the pull request. Accuracy claims in docs must come from a
reproducible run, never estimates.

## Guidelines

- Keep pull requests focused; one logical change per PR.
- Add or update tests for behaviour changes.
- Use [Conventional Commits](https://www.conventionalcommits.org/) style messages
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`).
- Never commit secrets, `.env` files, model weights (`*.onnx`, `*.safetensors`, ...) or
  downloaded datasets; `.gitignore` covers the usual paths. See
  [docs/WEIGHTS.md](./docs/WEIGHTS.md) for how weights are fetched.
- Code copied from other projects must be under a compatible license (Apache-2.0, MIT,
  BSD) and attributed in the relevant `NOTICE` file.

## Licensing of contributions

Unless you state otherwise, contributions to Apache-2.0 parts of the repository are
licensed under Apache-2.0, and contributions to the MIT-licensed directories (`sdk/js`,
`sdk/python`, `adapters/python`, `skills`) under MIT, as described in section 5 of the
Apache License. See [NOTICE](./NOTICE).
