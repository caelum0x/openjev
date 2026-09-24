import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { SKILL_MD } from "@/lib/jev/skill-md";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/skill")({
  head: () =>
    pageHead("Agent skill", "Install the OpenJev agent skill so coding agents can use typed decisions."),
  component: SkillPage,
});

function SkillPage() {
  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
              Agent skill
            </p>
            <h1 className="text-2xl font-medium tracking-tight">SKILL.md</h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted">
              Drop-in skill for Claude Code, Codex, and other agents. Also served
              at <span className="font-mono text-fg">GET /api/v1/skill</span>.
            </p>
          </div>
          <CopyButton text={SKILL_MD} label="Copy SKILL.md" />
        </header>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-surface p-4 font-mono text-[12px] leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {SKILL_MD}
        </pre>
      </div>
    </AppShell>
  );
}
