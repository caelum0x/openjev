/**
 * Support triage — OpenJev routing and urgency scoring for support tickets.
 *
 * Semantic routing of inbound support tickets is precisely the gap between a
 * keyword-match rule (rigid, brittle on paraphrase) and a full LLM (expensive
 * per-call, no confidence signal, no escalation band). OpenJev provides the
 * middle ground: typed, thresholded judgments with explicit escalation paths.
 *
 * Pattern:
 *   1. Receive a ticket from any channel (email, in-app, webhook).
 *   2. Call `triageTicket` to get: urgency, category, sentiment, and routing.
 *   3. `shouldEscalate` tells you whether the ticket bypasses the queue entirely
 *      (e.g. a data-loss report or an angry high-value customer).
 *   4. For volume: use `batchTriageTickets` (concurrent, same cost per ticket).
 *
 * All thresholds are in code; re-tune without re-running inference.
 */

import { OpenJevClient } from '../src/client.ts';
import { choice, noul, score, isChoice, isNoul, isScore } from '../src/primitives.ts';
import { decideChoice, decideNoul, decideScore } from '../src/decide.ts';

// ---- Types ----------------------------------------------------------------

/** A support ticket as received from any channel. */
export interface SupportTicket {
  readonly id: string;
  readonly subject: string;
  readonly body: string;
  /** Channel the ticket arrived on. */
  readonly channel: 'email' | 'in_app' | 'chat' | 'api' | 'other';
  /** Customer plan tier — used to weight escalation decisions. */
  readonly plan?: 'free' | 'pro' | 'team' | 'enterprise';
  /** Account age in days, for context. */
  readonly accountAgeDays?: number;
  /** Number of previous tickets from this customer in the past 30 days. */
  readonly priorTicketsLast30d?: number;
}

/**
 * The urgency of the ticket from the customer's perspective, not just tone.
 * A factual report of "my data is gone" is `critical` even if the prose is calm.
 */
export type TicketUrgency = 'low' | 'medium' | 'high' | 'critical';

/**
 * Category drives queue routing. Always include an `other` option so the model
 * can gracefully express "none of the above" rather than forcing a bad fit.
 */
export type TicketCategory =
  | 'billing'
  | 'bug_report'
  | 'data_loss'
  | 'feature_request'
  | 'account_access'
  | 'performance'
  | 'security'
  | 'onboarding'
  | 'other';

export type CustomerSentiment = 'positive' | 'neutral' | 'frustrated' | 'angry';

/** The team or queue this ticket should be routed to. */
export type RoutingTarget =
  | 'tier1_support'
  | 'tier2_technical'
  | 'billing_team'
  | 'security_team'
  | 'engineering_escalation'
  | 'customer_success';

export interface TriageResult {
  readonly ticketId: string;
  readonly urgency: TicketUrgency;
  readonly category: TicketCategory;
  readonly sentiment: CustomerSentiment;
  readonly routingTarget: RoutingTarget;
  /**
   * True when this ticket should skip the queue and be handled immediately.
   * Triggers when urgency=critical, category=data_loss or security, or the
   * customer is enterprise with high frustration.
   */
  readonly shouldEscalate: boolean;
  /**
   * Suggested SLA target in hours (code-computed from urgency + plan, not model
   * output). Zero means "handle now".
   */
  readonly suggestedSlaHours: number;
  readonly confidence: number;
  readonly reason: string;
}

// ---- triageTicket ---------------------------------------------------------

/** Urgency level descriptions used as Score criteria. */
const URGENCY_LEVELS = [
  'Low: a question, suggestion, or non-blocking curiosity. Customer is not impaired.',
  'Medium: a real issue but the customer can still use the product.',
  'High: a significant blocker; the customer cannot complete an important workflow.',
  'Critical: data loss, security incident, complete outage, or the business is stopped.',
] as const;

/**
 * Triage a single support ticket: classify urgency, category, sentiment, and
 * routing target in one batched call.
 */
export async function triageTicket(
  client: OpenJevClient,
  ticket: SupportTicket,
): Promise<TriageResult> {
  const res = await client.systemOne({
    state: {
      ticket: {
        subject: ticket.subject,
        body: ticket.body,
        channel: ticket.channel,
        plan: ticket.plan ?? 'free',
        accountAgeDays: ticket.accountAgeDays ?? null,
        priorTicketsLast30d: ticket.priorTicketsLast30d ?? 0,
      },
      note: 'Triage this support ticket. Base urgency on the actual impact to the customer, not just their tone. A calm report of data loss is still critical.',
    },
    questions: {
      urgency: score(
        'How urgent is this ticket based on the actual impact to the customer?',
        URGENCY_LEVELS,
      ),
      category: choice(
        'What is the primary category of this support ticket?',
        {
          billing: 'Payment, invoice, subscription, refund, or pricing question.',
          bug_report: 'A product defect or unexpected behavior.',
          data_loss: 'Data was deleted, corrupted, or is inaccessible.',
          feature_request: 'A request for new functionality or an improvement.',
          account_access: 'Cannot log in, password reset, 2FA, or permissions.',
          performance: 'Slow response times, timeouts, or degraded performance.',
          security: 'Potential breach, unauthorized access, or vulnerability report.',
          onboarding: 'Help getting started, setup guidance, or how-to questions.',
          other: 'Does not fit clearly into any of the above.',
        },
      ),
      sentiment: choice(
        'What is the customer\'s emotional tone in this ticket?',
        {
          positive: 'Friendly, grateful, or enthusiastic.',
          neutral: 'Matter-of-fact; no strong emotion.',
          frustrated: 'Clearly bothered or disappointed but professional.',
          angry: 'Explicitly upset, threatening churn, or using aggressive language.',
        },
      ),
      routingTarget: choice(
        'Which team should handle this ticket first?',
        {
          tier1_support: 'Standard support queue: how-to, general questions, minor issues.',
          tier2_technical: 'Technical support: bugs, integrations, API issues.',
          billing_team: 'Billing, subscription, or payment issues.',
          security_team: 'Security incidents or vulnerability reports.',
          engineering_escalation:
            'Production outage, data loss, or critical bugs needing an engineer.',
          customer_success: 'Enterprise accounts, churn risk, or relationship management.',
        },
      ),
    },
  });

  const urgencyAns = res.answers.urgency;
  const categoryAns = res.answers.category;
  const sentimentAns = res.answers.sentiment;
  const routingAns = res.answers.routingTarget;

  // Resolve with confidence thresholds; fall back to conservative defaults.
  const urgencyScore = isScore(urgencyAns) ? urgencyAns.score : 1;
  const confidence = isScore(urgencyAns) ? urgencyAns.confidence : 0;

  const urgency = resolveUrgency(urgencyScore);

  const categoryVerdict = isChoice(categoryAns)
    ? decideChoice<TicketCategory>(categoryAns, { minConfidence: 0.65 })
    : null;
  const category: TicketCategory =
    categoryVerdict?.decided ? (categoryVerdict.outcome as TicketCategory) : 'other';

  const sentimentVerdict = isChoice(sentimentAns)
    ? decideChoice<CustomerSentiment>(sentimentAns, { minConfidence: 0.6 })
    : null;
  const sentiment: CustomerSentiment =
    sentimentVerdict?.decided ? (sentimentVerdict.outcome as CustomerSentiment) : 'neutral';

  const routingVerdict = isChoice(routingAns)
    ? decideChoice<RoutingTarget>(routingAns, { minConfidence: 0.65 })
    : null;

  // Code-level routing overrides take precedence over the model.
  let routingTarget: RoutingTarget =
    routingVerdict?.decided ? (routingVerdict.outcome as RoutingTarget) : 'tier1_support';
  if (category === 'data_loss' || category === 'security') {
    routingTarget =
      category === 'security' ? 'security_team' : 'engineering_escalation';
  }
  if (ticket.plan === 'enterprise' && (urgency === 'high' || urgency === 'critical')) {
    routingTarget = 'customer_success';
  }

  // Escalation logic: bypass queue when the impact is critical.
  const shouldEscalate =
    urgency === 'critical' ||
    category === 'data_loss' ||
    category === 'security' ||
    (ticket.plan === 'enterprise' && sentiment === 'angry') ||
    (urgency === 'high' && sentiment === 'angry');

  const suggestedSlaHours = computeSla(urgency, ticket.plan);

  const urgencyVerdict = isScore(urgencyAns)
    ? decideScore(urgencyAns, { atOrAbove: 2 })
    : { reason: `urgency=${urgency}`, outcome: 'below' as const, decided: true, strength: 1 };

  return {
    ticketId: ticket.id,
    urgency,
    category,
    sentiment,
    routingTarget,
    shouldEscalate,
    suggestedSlaHours,
    confidence,
    reason: urgencyVerdict.reason,
  };
}

// ---- batchTriageTickets ---------------------------------------------------

/**
 * Triage a batch of tickets concurrently. Each ticket is one API call; they run
 * in parallel. Returns results in the same order as the input array.
 *
 * For very large batches, chunk into groups of ~50 to avoid overwhelming the
 * event loop with concurrent connections.
 */
export async function batchTriageTickets(
  client: OpenJevClient,
  tickets: readonly SupportTicket[],
  concurrency = 20,
): Promise<TriageResult[]> {
  const results: TriageResult[] = new Array(tickets.length);
  for (let i = 0; i < tickets.length; i += concurrency) {
    const chunk = tickets.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map((t) => triageTicket(client, t)));
    for (let j = 0; j < chunkResults.length; j++) {
      const r = chunkResults[j];
      if (r !== undefined) results[i + j] = r;
    }
  }
  return results;
}

// ---- Internal helpers -----------------------------------------------------

function resolveUrgency(score: number): TicketUrgency {
  if (score >= 2.5) return 'critical';
  if (score >= 1.75) return 'high';
  if (score >= 0.75) return 'medium';
  return 'low';
}

function computeSla(urgency: TicketUrgency, plan?: SupportTicket['plan']): number {
  const base: Record<TicketUrgency, number> = {
    critical: 0,
    high: 4,
    medium: 24,
    low: 72,
  };
  const multiplier: Record<NonNullable<SupportTicket['plan']>, number> = {
    enterprise: 0.25,
    team: 0.5,
    pro: 0.75,
    free: 1,
  };
  const base_h = base[urgency];
  const mult = plan ? (multiplier[plan] ?? 1) : 1;
  return Math.round(base_h * mult);
}

export { OpenJevClient };
/** @deprecated Use {@link OpenJevClient} instead. */
export { OpenJevClient as TypeSafeClient };

// Re-export for convenience.
export type { SupportTicket as Ticket };
