# OpenJev Agent Skills

Agent skills for building with [OpenJev](https://github.com/caelum0x/openjev): typed decisions and probabilities from System One models.

OpenJev is the open-source, self-hostable edition of the TypeSafe System One service, and stays **wire-compatible with the TypeSafe System One v1 API**. The same skill works whether your agent targets a self-hosted OpenJev URL or the hosted `https://api.typesafe.ai/v1` endpoint.

You can [read SKILL.md on GitHub](https://github.com/caelum0x/openjev/blob/main/skills/skills/openjev/SKILL.md) or fetch its [raw Markdown](https://raw.githubusercontent.com/caelum0x/openjev/main/skills/skills/openjev/SKILL.md). A live OpenJev deployment also serves it at `GET /api/v1/skill` (Markdown) or `/skill`.

## Configure the endpoint

The skill reads the base URL and credential from the environment so the same code targets either deployment:

| Env var | Purpose | Default |
|---|---|---|
| `OPENJEV_BASE_URL` | System One base URL | `https://api.typesafe.ai/v1` (overridable to any self-hosted OpenJev URL) |
| `OPENJEV_API_KEY` | API key (falls back to `TYPESAFE_API_KEY`) | — |

The default base URL is only a default. Point `OPENJEV_BASE_URL` at your self-hosted instance (for example `http://localhost:3000/api/v1`) and the request/response shapes stay identical.

## Install

### Claude Code plugin

The plugin marketplace lives in the `skills/` directory of the
[OpenJev monorepo](https://github.com/caelum0x/openjev). Clone it and add the
marketplace from that directory:

```bash
git clone https://github.com/caelum0x/openjev.git
claude plugin marketplace add ./openjev/skills
claude plugin install openjev@openjev
```

### Other agents via skills.sh

```bash
npx skills add caelum0x/openjev --skill OpenJev
```

Select your agent when prompted. Installation is project-local by default; add `-g` to install globally.

## Use

Ask your agent, for example:

> Use OpenJev to route incoming support tickets by department, with human review for uncertain decisions.

In Claude Code, you can explicitly invoke the plugin skill with `/openjev:openjev`.

| Skill | Purpose |
|---|---|
| [OpenJev](skills/openjev/SKILL.md) | Design OpenJev workflows, find current docs and cookbooks, and compose typed judgments in code |

## Credits

Based on [`@typesafe-ai/skills`](https://github.com/typesafe-ai/skills) (MIT). See [NOTICE](NOTICE).

## License

[MIT](LICENSE).
