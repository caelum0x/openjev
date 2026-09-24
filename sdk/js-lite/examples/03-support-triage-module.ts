/**
 * Module in action: support-triage.
 *
 * Demonstrates the support-triage module routing a mixed batch of tickets.
 * Each ticket is triaged concurrently; the results are printed sorted by
 * urgency so critical items surface immediately.
 *
 * Real-world integration: call triageTicket (or batchTriageTickets) inside your
 * webhook handler that receives tickets from Intercom / Front / Zendesk and
 * writes the routing decision back to the ticket metadata before it enters
 * the queue.
 *
 * Run: tsx examples/03-support-triage-module.ts
 * Requires: TYPESAFE_API_KEY in env.
 */

import { TypeSafeClient } from '../src/client.ts';
import { batchTriageTickets } from '../modules/support-triage.ts';
import type { SupportTicket } from '../modules/support-triage.ts';

const client = new TypeSafeClient();

// A realistic mixed inbox.
const tickets: SupportTicket[] = [
  {
    id: 'TKT-001',
    subject: 'How do I export my data?',
    body: 'Hi, I would like to download all my project data as a CSV. I cannot find this option in settings. Thanks!',
    channel: 'email',
    plan: 'pro',
    accountAgeDays: 120,
    priorTicketsLast30d: 0,
  },
  {
    id: 'TKT-002',
    subject: 'All my projects are gone!!!',
    body: 'I logged in this morning and ALL of my projects have disappeared. I have been a customer for 2 years and this is completely unacceptable. I need this resolved IMMEDIATELY or I am cancelling my enterprise contract.',
    channel: 'email',
    plan: 'enterprise',
    accountAgeDays: 730,
    priorTicketsLast30d: 1,
  },
  {
    id: 'TKT-003',
    subject: 'Billing question',
    body: 'I upgraded from Pro to Team last week. My invoice shows the old Pro price. Was I charged correctly?',
    channel: 'in_app',
    plan: 'team',
    accountAgeDays: 200,
    priorTicketsLast30d: 0,
  },
  {
    id: 'TKT-004',
    subject: 'API returns 500 on POST /projects',
    body: 'Getting intermittent 500 errors on POST /v1/projects when the request body is larger than ~50kb. Reproducible with the attached curl example. Error: "Request entity too large".',
    channel: 'api',
    plan: 'team',
    accountAgeDays: 90,
    priorTicketsLast30d: 2,
  },
  {
    id: 'TKT-005',
    subject: 'Feature request: dark mode',
    body: 'Would love to see a dark mode option in the dashboard. Would really help during late-night work sessions!',
    channel: 'in_app',
    plan: 'free',
    accountAgeDays: 14,
    priorTicketsLast30d: 0,
  },
];

console.log(`Triaging ${tickets.length} tickets concurrently...\n`);

const results = await batchTriageTickets(client, tickets);

// Sort: critical first, then by SLA ascending.
const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
results.sort((a, b) => {
  const ua = urgencyOrder[a.urgency];
  const ub = urgencyOrder[b.urgency];
  return ua !== ub ? ua - ub : a.suggestedSlaHours - b.suggestedSlaHours;
});

const widths = { id: 8, urgency: 9, category: 20, routing: 25, sla: 6, escalate: 9 };

const header =
  'ID'.padEnd(widths.id) +
  'URGENCY'.padEnd(widths.urgency) +
  'CATEGORY'.padEnd(widths.category) +
  'ROUTE TO'.padEnd(widths.routing) +
  'SLA(h)'.padEnd(widths.sla) +
  'ESCALATE';

console.log(header);
console.log('-'.repeat(header.length));

for (const r of results) {
  const line =
    r.ticketId.padEnd(widths.id) +
    r.urgency.padEnd(widths.urgency) +
    r.category.padEnd(widths.category) +
    r.routingTarget.padEnd(widths.routing) +
    String(r.suggestedSlaHours).padEnd(widths.sla) +
    (r.shouldEscalate ? 'YES' : 'no');
  console.log(line);
}

console.log();
console.log('Detail for escalated tickets:');
for (const r of results.filter((r) => r.shouldEscalate)) {
  console.log(`\n  ${r.ticketId}: ${r.urgency.toUpperCase()} — ${r.reason}`);
  console.log(`  confidence: ${r.confidence.toFixed(3)}`);
}
