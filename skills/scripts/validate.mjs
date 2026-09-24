#!/usr/bin/env node
// Zero-dependency validation of the openjev skill package.
// Verifies the Claude Code plugin manifest, skills.sh skill structure,
// MIT licensing, attribution NOTICE, and the wire-compatible System One
// contract (model + state + questions-as-dict, env-configurable base URL).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];

function ok(name, cond) {
  if (cond) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

// Minimal YAML frontmatter parser (flat key: value, enough for SKILL.md).
function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].trim();
    } else if (key && line.trim()) {
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

// 1. Plugin manifest (Claude Code).
const plugin = read(".claude-plugin/plugin.json");
ok("plugin.json exists", plugin !== null);
if (plugin) {
  const j = JSON.parse(plugin);
  ok("plugin name is openjev", j.name === "openjev");
  ok("plugin license MIT", j.license === "MIT");
  ok("plugin repository -> caelum0x/openjev monorepo", /caelum0x\/openjev(\.git)?$/.test(j.repository || ""));
  ok("plugin has no TypeSafe branding in name/desc", !/typesafe ai|typesafe-ai/i.test(`${j.name} ${j.description} ${j.author?.name}`));
}

// 2. Marketplace manifest.
const market = read(".claude-plugin/marketplace.json");
ok("marketplace.json exists", market !== null);
if (market) {
  const j = JSON.parse(market);
  ok("marketplace name is openjev", j.name === "openjev");
  ok("marketplace has one plugin named openjev", Array.isArray(j.plugins) && j.plugins[0]?.name === "openjev");
}

// 3. Skill file structure (skills.sh / Claude Code SKILL.md).
const skill = read("skills/openjev/SKILL.md");
ok("skills/openjev/SKILL.md exists", skill !== null);
ok("old skills/typesafe-ai dir is gone", !existsSync(join(ROOT, "skills/typesafe-ai")));
if (skill) {
  const fm = frontmatter(skill);
  ok("SKILL.md has frontmatter", fm !== null);
  ok("SKILL.md name is openjev", fm?.name === "openjev");
  ok("SKILL.md license MIT", fm?.license === "MIT");
  ok("SKILL.md description non-empty", (fm?.description || "").length > 40);
  ok("SKILL.md title rebranded", /#\s*Build with OpenJev/.test(skill));

  // Wire contract must be intact and dual-endpoint.
  ok("contract: POST /v1/systemone", /\/v1\/systemone|\/api\/v1\/systemone/.test(skill));
  ok("contract: model field", /"model"\s*:/.test(skill));
  ok("contract: state field", /"state"\s*:/.test(skill));
  ok("contract: questions-as-dict", /"questions"\s*:\s*\{/.test(skill));
  ok("contract: answers keyed by id", /"answers"\s*:\s*\{/.test(skill));

  // Env-configurable base URL, default kept + overridable.
  ok("env: OPENJEV_BASE_URL", /OPENJEV_BASE_URL/.test(skill));
  ok("env: default is api.typesafe.ai/v1", /https:\/\/api\.typesafe\.ai\/v1/.test(skill));
  ok("env: OPENJEV_API_KEY", /OPENJEV_API_KEY/.test(skill));
  ok("env: TYPESAFE_API_KEY fallback", /TYPESAFE_API_KEY/.test(skill));
  ok("wire-compat statement present", /wire-compatible/i.test(skill));
}

// 4. Licensing + attribution.
const license = read("LICENSE");
ok("root LICENSE is MIT", (license || "").includes("MIT License"));
ok("skill LICENSE is MIT", (read("skills/openjev/LICENSE") || "").includes("MIT License"));
const notice = read("NOTICE");
ok("NOTICE exists", notice !== null);
ok("NOTICE credits @typesafe-ai/skills (MIT)", /typesafe-ai\/skills/.test(notice || "") && /MIT/.test(notice || ""));

// 5. README rebrand.
const readme = read("README.md");
ok("README rebranded to openjev", /openjev Agent Skills/i.test(readme || ""));
ok("README points install at caelum0x/openjev monorepo", /npx skills add caelum0x\/openjev /.test(readme || "") && !/openjev-skills/.test(readme || ""));

// Report.
if (failures.length) {
  console.error(`FAIL (${passed} passed, ${failures.length} failed):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`ok - ${passed} checks passed`);
