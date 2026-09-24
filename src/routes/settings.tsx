import { useEffect, useState } from "react";
import { SITE_URL } from "@/lib/seo/site";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/lib/jev/browser";
import { pageHead } from "@/lib/seo/site";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountProfile = {
  user_id: string;
  email: string | null;
  name: string | null;
  display_name: string | null;
  org_name: string | null;
  org_slug: string | null;
  timezone: string | null;
  theme: "system" | "light" | "dark";
  email_digest: boolean;
  updated_at: number | null;
};

type PublicWebhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret_hint: string;
  created_at: number;
  last_delivery_at: number | null;
};

type CreatedWebhook = PublicWebhook & { secret: string; warning: string };

type WebhookDelivery = {
  ok: boolean;
  status: number;
  signature: string;
  event: Record<string, unknown>;
  duration_ms: number;
  error?: string;
};

type BillingPlan = {
  code: string;
  name: string;
  tier: "selfhost" | "free" | "calibrate" | "team";
  source: "railyard" | "derived";
  monthly_fee_cents: number;
  included_decisions: number;
};
type PlanQuota = {
  rpm_limit: number;
  monthly_quota: number;
  source: "db" | "default";
};
type BillingPeriod = { label: string; start: string; end: string };
type BillingUsage = {
  calls: number;
  questions: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
};
type BillingCost = {
  estimated_cents: number;
  currency: "usd";
  source: "railyard" | "derived";
  rate_per_call_cents: number;
  rate_per_1k_decisions_usd: number;
  plan_fee_cents: number;
  overage_decisions: number;
  charges: Array<{ code: string; amount_cents: number; units?: number }>;
};
type BillingInvoice = {
  id: string;
  month: string;
  calls: number;
  tokens: number;
  amount_cents: number;
  status: "open" | "paid";
  issued_at: number;
};
type BillingSummary = {
  plan: BillingPlan;
  quota: PlanQuota;
  metering: { configured: boolean };
  period: BillingPeriod;
  usage: BillingUsage;
  cost: BillingCost;
  invoices: BillingInvoice[];
};

// ─── Route ────────────────────────────────────────────────────────────────────

type Tab = "account" | "organization" | "webhooks" | "billing" | "api";

const TABS: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "organization", label: "Organization" },
  { id: "webhooks", label: "Webhooks" },
  { id: "billing", label: "Billing" },
  { id: "api", label: "API" },
];

export const Route = createFileRoute("/settings")({
  head: () => pageHead("Settings"),
  component: SettingsPage,
});

function SettingsPage() {
  const [tab, setTab] = useState<Tab>("account");

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Settings
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Account preferences, organization details, webhooks, billing, and
            API access.
          </p>
        </header>

        {/* Tab selector */}
        <div className="flex flex-wrap gap-1 rounded-md bg-raised p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "rounded px-3 py-1 font-mono text-xs uppercase tracking-[0.14em] transition-colors",
                tab === t.id
                  ? "bg-surface text-fg shadow-[var(--shadow-border)]"
                  : "text-muted hover:text-fg",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "account" && <AccountTab />}
        {tab === "organization" && <OrgTab />}
        {tab === "webhooks" && <WebhooksTab />}
        {tab === "billing" && <BillingTab />}
        {tab === "api" && <ApiTab />}
      </div>
    </AppShell>
  );
}

// ─── Account tab ──────────────────────────────────────────────────────────────

function AccountTab() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [emailDigest, setEmailDigest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ data: AccountProfile }>("/api/v1/account");
      setProfile(res.data);
      setDisplayName(res.data.display_name ?? "");
      setTimezone(res.data.timezone ?? "");
      setTheme(res.data.theme);
      setEmailDigest(res.data.email_digest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load account");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/v1/account", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName || null,
          timezone: timezone || null,
          theme,
          email_digest: emailDigest,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="rounded-md bg-surface px-5 py-5 shadow-[var(--shadow-border)] space-y-4">
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Email
          </p>
          <p className="text-sm">{profile?.email ?? "—"}</p>
          <p className="font-mono text-[10px] text-muted mt-0.5">
            Managed by your auth provider
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            User ID
          </p>
          <p className="font-mono text-xs text-muted break-all">
            {profile?.user_id ?? "—"}
          </p>
        </div>
        {profile?.name ? (
          <div className="space-y-0.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Name (auth)
            </p>
            <p className="text-sm text-muted">{profile.name}</p>
          </div>
        ) : null}
      </div>

      <form className="space-y-4" onSubmit={(e) => void save(e)}>
        <div className="space-y-1.5">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
            htmlFor="display-name"
          >
            Display name
          </label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
            htmlFor="timezone"
          >
            Timezone
          </label>
          <Input
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. America/New_York"
          />
          <p className="font-mono text-[10px] text-muted">
            IANA timezone identifier. Used for digest scheduling.
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
            htmlFor="theme"
          >
            Theme
          </label>
          <select
            id="theme"
            value={theme}
            onChange={(e) =>
              setTheme(e.target.value as "system" | "light" | "dark")
            }
            className="h-11 w-full rounded-sm bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="email-digest"
            checked={emailDigest}
            onChange={(e) => setEmailDigest(e.target.checked)}
            className="size-4 rounded border-border accent-accent"
          />
          <label
            htmlFor="email-digest"
            className="cursor-pointer text-sm"
          >
            Weekly email digest
          </label>
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
        </Button>
      </form>
    </div>
  );
}

// ─── Organization tab ─────────────────────────────────────────────────────────

function OrgTab() {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ data: AccountProfile }>("/api/v1/account");
      setOrgName(res.data.org_name ?? "");
      setOrgSlug(res.data.org_slug ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load account");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/v1/account", {
        method: "PATCH",
        body: JSON.stringify({
          org_name: orgName || null,
          org_slug: orgSlug || null,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <form className="space-y-4" onSubmit={(e) => void save(e)}>
        <div className="space-y-1.5">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
            htmlFor="org-name"
          >
            Organization name
          </label>
          <Input
            id="org-name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Acme Inc."
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
            htmlFor="org-slug"
          >
            Organization slug
          </label>
          <Input
            id="org-slug"
            value={orgSlug}
            onChange={(e) => setOrgSlug(e.target.value)}
            placeholder="acme"
          />
          <p className="font-mono text-[10px] text-muted">
            Lowercase letters, numbers, and hyphens. Auto-derived from name if
            blank.
          </p>
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
        </Button>
      </form>
    </div>
  );
}

// ─── Webhooks tab ─────────────────────────────────────────────────────────────

function WebhooksTab() {
  const [hooks, setHooks] = useState<PublicWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdHook, setCreatedHook] = useState<CreatedWebhook | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    delivery: WebhookDelivery;
  } | null>(null);
  const [confirmDeleteHook, setConfirmDeleteHook] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ data: PublicWebhook[] }>("/api/v1/webhooks");
      setHooks(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setCreatedHook(null);
    try {
      const events = newEvents
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api<CreatedWebhook>("/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: newUrl, events }),
      });
      setCreatedHook(res);
      setNewUrl("");
      setNewEvents("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(hook: PublicWebhook) {
    try {
      await api(
        `/api/v1/webhooks?id=${encodeURIComponent(hook.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ active: !hook.active }),
        },
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function testHook(id: string) {
    setTestResult(null);
    try {
      const res = await api<{ data: WebhookDelivery }>(
        `/api/v1/webhooks?action=test&id=${encodeURIComponent(id)}`,
        { method: "POST", body: JSON.stringify({ id }) },
      );
      setTestResult({ id, delivery: res.data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    }
  }

  async function deleteHook(id: string) {
    try {
      await api(`/api/v1/webhooks?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (testResult?.id === id) setTestResult(null);
      setConfirmDeleteHook(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {/* Create form */}
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => void create(e)}
      >
        <div className="flex-1 space-y-1.5">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
            htmlFor="wh-url"
          >
            URL
          </label>
          <Input
            id="wh-url"
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/webhooks/ots"
            required
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
            htmlFor="wh-events"
          >
            Events (comma-separated, blank = all)
          </label>
          <Input
            id="wh-events"
            value={newEvents}
            onChange={(e) => setNewEvents(e.target.value)}
            placeholder="decision, key.created"
          />
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? "Adding…" : "Add webhook"}
        </Button>
      </form>

      {/* One-time secret reveal */}
      {createdHook ? (
        <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)] space-y-2">
          <p className="text-sm text-muted">{createdHook.warning}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Signing secret — shown once
          </p>
          <p className="break-all font-mono text-sm">{createdHook.secret}</p>
          <CopyButton text={createdHook.secret} label="Copy secret" />
        </div>
      ) : null}

      {/* Test result */}
      {testResult ? (
        <div
          className={[
            "rounded-md px-4 py-4 shadow-[var(--shadow-border)] space-y-1.5",
            testResult.delivery.ok ? "bg-surface" : "bg-danger/10",
          ].join(" ")}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Test delivery&nbsp;—&nbsp;
            <span className={testResult.delivery.ok ? "text-score" : "text-danger"}>
              {testResult.delivery.ok ? "OK" : "Failed"}
            </span>
            {testResult.delivery.status > 0
              ? ` (HTTP ${testResult.delivery.status})`
              : ""}
            &nbsp;—&nbsp;{testResult.delivery.duration_ms}ms
          </p>
          {testResult.delivery.error ? (
            <p className="text-sm text-danger">{testResult.delivery.error}</p>
          ) : null}
          <p className="font-mono text-[10px] text-muted break-all">
            {testResult.delivery.signature}
          </p>
        </div>
      ) : null}

      {/* Hooks table */}
      <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            <tr>
              <th className="px-3 py-2">URL</th>
              <th className="px-3 py-2">Events</th>
              <th className="px-3 py-2">Hint</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => (
              <tr key={h.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 font-mono text-xs max-w-[200px] truncate">
                  {h.url}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted">
                  {h.events.length > 0 ? (
                    h.events.join(", ")
                  ) : (
                    <span className="text-subtle">all</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted">
                  {h.secret_hint}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void toggleActive(h)}
                    className={[
                      "font-mono text-[10px] uppercase tracking-[0.12em] transition-opacity hover:opacity-70",
                      h.active ? "text-score" : "text-subtle",
                    ].join(" ")}
                  >
                    {h.active ? "active" : "paused"}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void testHook(h.id)}
                    >
                      Test
                    </Button>
                    {confirmDeleteHook === h.id ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="mr-1 text-xs text-danger">Delete?</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          onClick={() => void deleteHook(h.id)}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDeleteHook(null)}
                        >
                          No
                        </Button>
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmDeleteHook(h.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {loading && hooks.length === 0 ? (
              <tr aria-busy="true">
                <td className="px-3 py-6 text-sm text-muted" colSpan={5}>
                  Loading webhooks…
                </td>
              </tr>
            ) : null}
            {!loading && hooks.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-sm text-muted" colSpan={5}>
                  No webhooks yet. Add one above to receive signed event
                  deliveries.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="rounded-md bg-raised px-4 py-3">
        <p className="text-xs text-muted leading-relaxed">
          Deliveries are signed with HMAC-SHA256. Verify the{" "}
          <span className="font-mono">X-OTS-Signature</span> header:{" "}
          <span className="font-mono">t=&lt;unix&gt;,v1=&lt;hex&gt;</span> where{" "}
          <span className="font-mono">hex = HMAC-SHA256(secret, "{'"'}&lt;t&gt;.&lt;body&gt;{'"'}")</span>.
        </p>
      </div>
    </div>
  );
}

// ─── Billing tab ──────────────────────────────────────────────────────────────

function BillingTab() {
  const [billing, setBilling] = useState<BillingSummary & { checkout_url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try {
      const res = await api<{ data: BillingSummary & { checkout_url?: string } }>("/api/v1/billing");
      setBilling(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleUpgrade() {
    // Plans and their checkout links live on /pricing (one source of truth).
    setUpgrading(true);
    try {
      await navigate({ to: "/pricing", search: {} });
    } finally {
      setUpgrading(false);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!billing)
    return <p className="text-sm text-muted">Loading billing data…</p>;

  const { plan, quota, period, usage, cost, invoices, metering } = billing;

  // Usage-vs-quota progress (0–100, capped at 100 for the bar width).
  const quotaUsed = usage.calls;
  const quotaLimit = quota.monthly_quota;
  const quotaPct =
    quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;
  const quotaUnlimited = quotaLimit === 0;
  const quotaNearLimit = !quotaUnlimited && quotaPct >= 80;
  const quotaExceeded = !quotaUnlimited && quotaUsed >= quotaLimit;

  return (
    <div className="space-y-6">
      {/* Plan + quota card */}
      <div className="rounded-md bg-surface px-5 py-5 shadow-[var(--shadow-border)] space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Plan
            </p>
            <p className="text-sm font-medium">{plan.name}</p>
            <p className="font-mono text-[10px] text-muted capitalize">
              {fmtCents(plan.monthly_fee_cents)}/mo ·{" "}
              {plan.included_decisions > 0
                ? `${fmtN(plan.included_decisions)} decisions included`
                : "unlimited"}{" "}
              · source: {plan.source}
              {metering.configured ? " · metered" : ""}
            </p>
          </div>
          {plan.tier === "free" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={upgrading}
              onClick={() => void handleUpgrade()}
            >
              {upgrading ? "…" : "Upgrade"}
            </Button>
          ) : null}
        </div>

        {/* Quota limits row */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-0.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Rate limit
            </p>
            <p className="font-mono text-sm tabular-nums">
              {quota.rpm_limit > 0 ? `${fmtN(quota.rpm_limit)} req / min` : "Unlimited"}
            </p>
            <p className="font-mono text-[10px] text-muted">per API key</p>
          </div>
          <div className="space-y-0.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Monthly quota
            </p>
            <p className="font-mono text-sm tabular-nums">
              {quotaUnlimited ? "Unlimited" : `${fmtN(quotaLimit)} decisions / month`}
            </p>
            <p className="font-mono text-[10px] text-muted">
              {quota.source === "db" ? "custom plan" : "free tier default"}
            </p>
          </div>
        </div>

        {/* Usage-vs-quota bar */}
        {!quotaUnlimited ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] text-subtle">
                Monthly usage — {fmtN(quotaUsed)} / {fmtN(quotaLimit)} decisions
              </p>
              <p
                className={[
                  "font-mono text-[10px] tabular-nums",
                  quotaExceeded
                    ? "text-danger"
                    : quotaNearLimit
                      ? "text-amber-500"
                      : "text-muted",
                ].join(" ")}
              >
                {quotaPct}%
              </p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
              <div
                className={[
                  "h-full rounded-full transition-all duration-500",
                  quotaExceeded
                    ? "bg-danger"
                    : quotaNearLimit
                      ? "bg-amber-500"
                      : "bg-accent",
                ].join(" ")}
                style={{ width: `${quotaPct}%` }}
              />
            </div>
            {quotaExceeded ? (
              <p className="font-mono text-[10px] text-danger">
                Quota exceeded — API calls will return HTTP 429 until the month resets.
              </p>
            ) : quotaNearLimit ? (
              <p className="font-mono text-[10px] text-amber-500">
                Approaching monthly limit.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Period + usage stats */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Current period —{" "}
          <span className="font-mono text-muted">{period.label}</span>
          <span className="ml-2 font-mono text-[10px] text-subtle">
            {period.start} → {period.end}
          </span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Calls" value={fmtN(usage.calls)} />
          <StatCard label="Questions" value={fmtN(usage.questions)} />
          <StatCard
            label="Tokens"
            value={fmtN(usage.tokens)}
            sub={`${fmtN(usage.input_tokens)} in · ${fmtN(usage.output_tokens)} out`}
          />
          <StatCard
            label="Estimated cost"
            value={fmtCents(cost.estimated_cents)}
            sub={`plan ${fmtCents(cost.plan_fee_cents)} + $${cost.rate_per_1k_decisions_usd}/1k over allowance (${cost.overage_decisions.toLocaleString("en-US")} over) · ${cost.source}`}
          />
        </div>
      </section>

      {/* Cost charges breakdown */}
      {cost.charges.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Charges</h2>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {cost.charges.map((c) => (
                  <tr
                    key={c.code}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                    <td className="px-3 py-2 font-mono text-xs text-right text-muted tabular-nums">
                      {c.units != null ? fmtN(c.units) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">
                      {fmtCents(c.amount_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Invoices */}
      {invoices.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Invoices</h2>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {inv.month}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">
                      {fmtN(inv.calls)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">
                      {fmtN(inv.tokens)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">
                      {fmtCents(inv.amount_cents)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={[
                          "font-mono text-[10px] uppercase tracking-[0.12em]",
                          inv.status === "paid" ? "text-score" : "text-muted",
                        ].join(" ")}
                      >
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted">No invoices yet for this account.</p>
      )}
    </div>
  );
}

// ─── API tab ──────────────────────────────────────────────────────────────────

function ApiTab() {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : SITE_URL;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Reference info */}
      <div className="rounded-md bg-surface px-5 py-5 shadow-[var(--shadow-border)] space-y-4">
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Base URL
          </p>
          <p className="font-mono text-sm break-all">{baseUrl}/api/v1</p>
        </div>
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Authentication
          </p>
          <p className="font-mono text-sm text-muted">
            Authorization: Bearer ots_live_…
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Primary endpoint
          </p>
          <p className="font-mono text-sm">POST /api/v1/systemone</p>
        </div>
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Response envelope
          </p>
          <p className="font-mono text-sm text-muted">
            {"{ data: <payload> }"} &nbsp;|&nbsp;{" "}
            {"{ error: { type, message } }"}
          </p>
        </div>
      </div>

      {/* Quick links */}
      <div className="space-y-2">
        <Link
          to="/keys"
          className="flex items-center justify-between rounded-md bg-surface px-5 py-4 shadow-[var(--shadow-border)] hover:bg-raised transition-colors"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium">API Keys</p>
            <p className="text-xs text-muted">
              Create and revoke bearer tokens for programmatic access
            </p>
          </div>
          <span className="font-mono text-sm text-muted shrink-0 ml-4">
            &rarr;
          </span>
        </Link>
        <Link
          to="/docs"
          className="flex items-center justify-between rounded-md bg-surface px-5 py-4 shadow-[var(--shadow-border)] hover:bg-raised transition-colors"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Documentation</p>
            <p className="text-xs text-muted">
              Full API reference, request/response types, and guides
            </p>
          </div>
          <span className="font-mono text-sm text-muted shrink-0 ml-4">
            &rarr;
          </span>
        </Link>
        <Link
          to="/sdks"
          className="flex items-center justify-between rounded-md bg-surface px-5 py-4 shadow-[var(--shadow-border)] hover:bg-raised transition-colors"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium">SDKs</p>
            <p className="text-xs text-muted">
              Official TypeScript and Python client libraries
            </p>
          </div>
          <span className="font-mono text-sm text-muted shrink-0 ml-4">
            &rarr;
          </span>
        </Link>
      </div>

      {/* Curl quick start */}
      <div className="rounded-md bg-surface px-5 py-5 shadow-[var(--shadow-border)] space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Quick start
        </p>
        <pre className="rounded bg-raised px-4 py-3 font-mono text-xs text-muted overflow-x-auto whitespace-pre leading-relaxed">
          {[
            `curl -X POST ${baseUrl}/api/v1/systemone \\`,
            `  -H "Authorization: Bearer ots_live_…" \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{"state":{"score":0.8},`,
            `       "questions":{"approve":{"type":"choice",`,
            `                    "options":["yes","no"]}}}'`,
          ].join("\n")}
        </pre>
      </div>

      {/* Webhook signature note */}
      <div className="rounded-md bg-surface px-5 py-5 shadow-[var(--shadow-border)] space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Webhook signatures
        </p>
        <p className="text-xs text-muted leading-relaxed">
          Every delivery carries{" "}
          <span className="font-mono">X-OTS-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</span>{" "}
          and <span className="font-mono">X-OTS-Event: &lt;kind&gt;</span>. Compute{" "}
          <span className="font-mono">
            HMAC-SHA256(secret, &quot;&lt;t&gt;.&lt;rawBody&gt;&quot;)
          </span>{" "}
          and compare to <span className="font-mono">v1</span> to verify
          authenticity. Rotate the secret from the Webhooks tab.
        </p>
      </div>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl tabular-nums tracking-tight">
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 font-mono text-[11px] text-muted">{sub}</p>
      ) : null}
    </div>
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtN(n: number) {
  return n.toLocaleString();
}

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
