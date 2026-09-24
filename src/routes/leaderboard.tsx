import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import LEADERBOARD from "@/lib/content/leaderboard.json";
import type { LeaderboardFile, LeaderboardRow, PublicTrack } from "@/lib/jev/leaderboard";
import { absUrl, articleLd, OG_IMAGE, SITE_NAME } from "@/lib/seo/site";

const DATA = LEADERBOARD as LeaderboardFile;

export const Route = createFileRoute("/leaderboard")({
  head: () => {
    const title = `Calibration leaderboard: typed-decision models · ${SITE_NAME}`;
    const description =
      "A reproducible leaderboard of typed-decision models on an in-repo gold suite and on Banking77, CLINC150 with out-of-scope queries, and AG News: accuracy, calibration (ECE, Brier), and how often each one admits it does not know.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: absUrl("/leaderboard") },
        { property: "og:image", content: OG_IMAGE },
        {
          "script:ld+json": articleLd({
            headline: "Typed-decision calibration leaderboard",
            description,
            path: "/leaderboard",
            dateModified: DATA.generated_at,
          }),
        },
      ],
      links: [{ rel: "canonical", href: absUrl("/leaderboard") }],
    };
  },
  component: LeaderboardPage,
});

function pct(v: number | undefined): string {
  return v === undefined ? "" : `${(v * 100).toFixed(1)}%`;
}

function num(v: number | undefined): string {
  return v === undefined ? "" : v.toFixed(3);
}

const KIND_LABEL: Record<LeaderboardRow["kind"], string> = {
  local: "Local engine",
  neural: "Neural",
  llm: "LLM",
  cascade: "Cascade",
  cloud: "Hosted",
  ablation: "Ablation",
};

const GOLD_TAB = "gold";

function LeaderboardPage() {
  const tracks = DATA.public_tracks ?? [];
  // Public datasets first: the gold suite is ours and the lexical engine was
  // tuned on it, so it is not the headline.
  const tabs = [
    ...tracks.map((t) => ({ id: t.id, name: t.name })),
    { id: GOLD_TAB, name: "Gold suite (in-repo)" },
  ];
  const [tab, setTab] = useState<string>(tabs[0]?.id ?? GOLD_TAB);
  const engine = DATA.embedding_engine;
  return (
    <AppShell>
      <article className="mx-auto max-w-5xl space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Leaderboard</p>
          <h1 className="text-3xl font-medium tracking-tight">Who says "I don't know"?</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            Every model below is scored by the same open harness on the same data: standard public
            test sets anyone can download
            {tracks.length > 0 ? ` (${tracks.map((t) => t.name).join(", ")})` : ""}, plus the
            in-repo {DATA.datasets.gold_cases}-case gold suite and {DATA.datasets.ood_pairs}{" "}
            out-of-scope pairs. Nothing here is self-reported: clone the repo and run{" "}
            <code className="font-mono">npm run leaderboard</code> to reproduce it. Generated{" "}
            {DATA.generated_at}.
          </p>
          {engine ? (
            <p className="max-w-3xl text-xs leading-relaxed text-muted">
              {"encoder" in engine ? (
                <>
                  Default local engine: sentence embeddings (
                  <code className="font-mono">{engine.encoder}</code>, int8 ONNX on CPU). Its
                  constants were fitted on held-out data only: {engine.fitted_on}
                </>
              ) : (
                <>Embedding engine not installed for this run: {engine.not_installed}</>
              )}
            </p>
          ) : null}
        </header>

        {tabs.length > 1 ? (
          <nav className="flex flex-wrap gap-2" aria-label="Datasets" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={
                  tab === t.id
                    ? "rounded-sm bg-fg px-3 py-2 font-mono text-xs text-bg"
                    : "rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
                }
              >
                {t.name}
              </button>
            ))}
          </nav>
        ) : null}

        {/* Every panel is rendered (inactive ones hidden) so the served HTML
            carries all the numbers, not only the default tab's. */}
        {tracks.map((t) => (
          <div
            key={t.id}
            id={`panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${t.id}`}
            hidden={tab !== t.id}
            className="space-y-10"
          >
            <PublicTrackView track={t} />
          </div>
        ))}
        <div
          id={`panel-${GOLD_TAB}`}
          role="tabpanel"
          aria-labelledby={`tab-${GOLD_TAB}`}
          hidden={tab !== GOLD_TAB}
          className="space-y-10"
        >
          <GoldView />
        </div>

        <section className="space-y-3 rounded-md bg-inset p-6">
          <h2 className="text-base font-medium tracking-tight">Method</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>
              Accuracy, ECE (10 equal-width bins) and Brier use each model's reported confidence
              (for yes/no questions, the probability of the chosen side).
            </li>
            <li>
              Gold suite: every graded assertion in{" "}
              <code className="font-mono">src/lib/jev/gold/</code>. Out-of-scope pairs use Choice
              and Score questions only: for a yes/no question an off-topic input has a correct
              answer ("no").
            </li>
            <li>
              Public tracks: each test example becomes one Choice question whose options are the
              dataset's classes (CLINC150's <code className="font-mono">oos</code> class is never
              offered). Rows are the test split (or a deterministic sample of it, as stated per
              track), identical for every model. Data is downloaded at run time and not stored in
              the repo.
            </li>
            <li>
              Out-of-scope score: 1 when the model abstains, otherwise the larger of its{" "}
              <code className="font-mono">ood</code> score and 1 minus its confidence. "Flagged at
              5% FPR" is the share of out-of-scope queries scoring strictly above the threshold that
              flags 5% of in-scope queries; ties at the threshold are not flagged. "AUROC of ood
              field" ranks by the backend's <code className="font-mono">ood</code> alone. That
              threshold is picked on the test set itself, so it is an upper bound on what a
              deployment sees. "At shipped threshold" uses no test-set tuning: an answer counts as
              flagged when its <code className="font-mono">ood</code> is at or above the abstention
              threshold the backend ships with; the false-alarm rate on in-scope queries is shown
              next to it.
            </li>
            <li>
              Harness: <code className="font-mono">{DATA.harness}</code>.
            </li>
          </ul>
          <p className="text-sm">
            <Link to="/benchmarks" className="underline decoration-border underline-offset-2">
              Latency and cost benchmarks
            </Link>
          </p>
        </section>
      </article>
    </AppShell>
  );
}

function NotRunList({
  rows,
}: {
  rows: ReadonlyArray<{ id: string; label: string; reason?: string }>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium tracking-tight">Not yet measured</h2>
      <p className="text-sm text-muted">
        These rows need something the last run did not have. They are listed instead of silently
        dropped.
      </p>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
            <span className="font-mono text-xs text-fg">{r.label}</span>
            <span className="block text-xs text-muted">{r.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PublicTrackView({ track }: { track: PublicTrack }) {
  const ran = track.rows.filter((r) => r.status === "ok");
  const pending = track.rows.filter((r) => r.status !== "ok");
  const hasOod = ran.some((r) => r.ood);
  const hasLatency = ran.some((r) => r.latency_ms);
  return (
    <>
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium tracking-tight">{track.name}</h2>
          <p className="text-sm text-muted">
            {track.description} {track.classes} classes; {track.sampled} of {track.total}{" "}
            {track.split} rows scored
            {track.oos_sampled > 0 ? `, ${track.oos_sampled} of them out of scope` : ""}. License:{" "}
            {track.license}.{" "}
            <a
              href={track.homepage}
              className="underline decoration-border underline-offset-2"
              rel="noreferrer"
            >
              Source
            </a>
          </p>
        </div>
        <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              <tr>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Accuracy</th>
                <th className="px-3 py-2">Mean confidence</th>
                <th className="px-3 py-2" title="Expected calibration error, lower is better">
                  ECE
                </th>
                <th className="px-3 py-2" title="Brier score, lower is better">
                  Brier
                </th>
                {hasOod ? (
                  <>
                    <th
                      className="px-3 py-2"
                      title="Out-of-scope queries flagged when 5% of in-scope queries are flagged, higher is better"
                    >
                      OOS flagged at 5% FPR
                    </th>
                    <th
                      className="px-3 py-2"
                      title="Area under the ROC curve of the out-of-scope score, 0.5 is chance"
                    >
                      OOS AUROC
                    </th>
                    <th
                      className="px-3 py-2"
                      title="AUROC of the backend's own ood field alone (0.5 is chance)"
                    >
                      AUROC of ood field
                    </th>
                    <th
                      className="px-3 py-2"
                      title="Out-of-scope queries flagged by the backend's own shipped threshold (no test-set tuning), with the in-scope false-alarm rate"
                    >
                      OOS flagged at shipped threshold (FPR)
                    </th>
                    <th
                      className="px-3 py-2"
                      title="Out-of-scope queries answered at confidence 0.9 or higher, lower is better"
                    >
                      OOS at 0.9+
                    </th>
                  </>
                ) : null}
                {hasLatency ? <th className="px-3 py-2">p50 ms</th> : null}
              </tr>
            </thead>
            <tbody className="font-mono text-xs tabular-nums">
              {ran.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="px-3 py-2">
                    <span className="text-fg">{r.label}</span>
                    <span className="block text-[10px] text-subtle">{r.id}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{KIND_LABEL[r.kind]}</td>
                  <td className="px-3 py-2">{pct(r.accuracy)}</td>
                  <td className="px-3 py-2">{num(r.avg_confidence)}</td>
                  <td className="px-3 py-2">{num(r.ece)}</td>
                  <td className="px-3 py-2">{num(r.brier)}</td>
                  {hasOod ? (
                    <>
                      <td className="px-3 py-2">{pct(r.ood?.flag_rate_at_5_fpr)}</td>
                      <td className="px-3 py-2">{num(r.ood?.auroc)}</td>
                      <td className="px-3 py-2">{num(r.ood?.auroc_ood_field)}</td>
                      <td className="px-3 py-2">
                        {r.ood?.at_shipped_threshold
                          ? `${pct(r.ood.at_shipped_threshold.flag_rate)} (${pct(r.ood.at_shipped_threshold.false_positive_rate)})`
                          : ""}
                      </td>
                      <td className="px-3 py-2">{pct(r.ood?.confident_rate)}</td>
                    </>
                  ) : null}
                  {hasLatency ? (
                    <td className="px-3 py-2">{r.latency_ms?.p50.toFixed(1) ?? ""}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Random guessing scores {pct(1 / Math.max(1, track.classes))} accuracy on this set. Every
          backend is zero-shot here: it sees only the class names (and, for AG News, one-line
          descriptions), never training examples. The lexical rows match words against those names,
          so fine-grained intent sets with many similar classes are their weakest case; the
          embedding engine compares meaning instead.
        </p>
      </section>
      <NotRunList rows={pending} />
    </>
  );
}

function GoldView() {
  const ran = DATA.rows.filter((r) => r.status === "ok");
  const pending = DATA.rows.filter((r) => r.status !== "ok");
  return (
    <>
      <section className="space-y-3">
        <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              <tr>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Accuracy</th>
                <th className="px-3 py-2">Strict pass</th>
                <th className="px-3 py-2" title="Expected calibration error, lower is better">
                  ECE
                </th>
                <th className="px-3 py-2" title="Brier score, lower is better">
                  Brier
                </th>
                <th
                  className="px-3 py-2"
                  title="Out-of-scope answers with confidence below 0.5 or abstained, higher is better"
                >
                  OOD flagged
                </th>
                <th
                  className="px-3 py-2"
                  title="Out-of-scope answers at confidence 0.9 or higher, lower is better"
                >
                  OOD at 0.9+
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs tabular-nums">
              {ran.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="px-3 py-2">
                    <span className="text-fg">{r.label}</span>
                    <span className="block text-[10px] text-subtle">{r.id}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{KIND_LABEL[r.kind]}</td>
                  <td className="px-3 py-2">{pct(r.gold?.accuracy)}</td>
                  <td className="px-3 py-2">{pct(r.gold?.strict_pass_rate)}</td>
                  <td className="px-3 py-2">{num(r.gold?.ece)}</td>
                  <td className="px-3 py-2">{num(r.gold?.brier)}</td>
                  <td className="px-3 py-2">{pct(r.ood?.flag_rate)}</td>
                  <td className="px-3 py-2">{pct(r.ood?.confident_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          The gold suite is ours, and it is small: the lexical engine's weights and the scope
          layer's thresholds were tuned on it, and the embedding engine's yes/no blend and part of
          its temperature were fitted on its even-numbered half, so treat these rows as a regression
          check rather than an accuracy claim; the public tracks are the evidence. The ablation row
          is the default engine with the out-of-scope layer switched off (
          <code className="font-mono">OTS_SCOPE_DAMPING=off</code>): it shows what the layer buys on
          off-topic input and what it costs on in-scope calibration. Latency is not in the committed
          file because it depends on the machine; set{" "}
          <code className="font-mono">LEADERBOARD_LATENCY=1</code> to record it locally.
        </p>
      </section>

      <NotRunList rows={pending} />
    </>
  );
}
