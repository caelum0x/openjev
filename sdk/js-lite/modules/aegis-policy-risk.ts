/**
 * Orion / aegis — OpenJev policy-safety gate.
 *
 * The aegis compiler already proves RLS policies deterministically (its mutation
 * harness breaks its own SQL and requires the matrix to notice). OpenJev does
 * NOT replace that proof. It sits at the human/agent trust boundary the compiler
 * cannot judge: "an AI just wrote this policy/migration — is it dangerous, does
 * it need a human before it ships?" That is exactly the #1 reproduced failure in
 * AI-built Supabase apps (missing/permissive RLS, service_role in the client),
 * and it is a semantic judgment, not a theorem.
 *
 * Gate placement: run this BEFORE applying a migration or publishing a policy.
 * `dangerous` or `escalate` blocks the apply and routes to a human review.
 *
 * Functions:
 *   judgePolicy          – judge a single RLS policy for safety
 *   judgeMigrationRisk   – judge whether a migration diff needs a human gate
 *   judgeAgentAction     – screen an AI agent action before it touches the DB
 *   scoreSchemaExposure  – how much of the schema surface is over-exposed?
 */
import { OpenJevClient } from '../src/client.ts';
import { choice, noul, score, isChoice, isNoul, isScore } from '../src/primitives.ts';
import { decideChoice, decideNoul, decideScore } from '../src/decide.ts';

export interface PolicyContext {
  readonly table: string;
  readonly schema: string;
  /** The SQL command the policy applies to. */
  readonly command: 'select' | 'insert' | 'update' | 'delete' | 'all';
  /** Raw USING / WITH CHECK expression, e.g. "true" or "auth.uid() = user_id". */
  readonly usingExpr?: string;
  readonly withCheckExpr?: string;
  /** Roles the policy is granted to. */
  readonly roles: readonly string[];
  /** True if this table is reachable by the anon/public key. */
  readonly anonReachable: boolean;
}

export type PolicySeverity = 'safe' | 'needs_review' | 'dangerous';

export interface PolicyVerdict {
  readonly severity: PolicySeverity | 'escalate';
  /** Block the apply and require a human? */
  readonly blockApply: boolean;
  readonly publicReadAll: boolean;
  readonly exposesServiceRole: boolean;
  readonly confidence: number;
  readonly findings: readonly string[];
  readonly reason: string;
}

/**
 * Judge a single RLS policy. Deterministic red flags (literal `true`,
 * service_role granted to anon) are caught in code; otsone judges the semantic
 * gray area.
 */
export async function judgePolicy(
  client: OpenJevClient,
  ctx: PolicyContext,
): Promise<PolicyVerdict> {
  const findings: string[] = [];
  const usingTrue = normalize(ctx.usingExpr) === 'true';
  const checkTrue = normalize(ctx.withCheckExpr) === 'true';
  const anonHasServiceRole =
    ctx.roles.map((r) => r.toLowerCase()).includes('service_role') && ctx.anonReachable;

  if (usingTrue && (ctx.command === 'select' || ctx.command === 'all')) {
    findings.push('USING (true) on a readable command — public read of every row.');
  }
  if (checkTrue && (ctx.command === 'insert' || ctx.command === 'update' || ctx.command === 'all')) {
    findings.push('WITH CHECK (true) — any caller can write arbitrary rows.');
  }
  if (anonHasServiceRole) {
    findings.push('service_role reachable by anon/public — full RLS bypass exposed.');
  }

  const res = await client.systemOne({
    state: {
      policy: {
        table: `${ctx.schema}.${ctx.table}`,
        command: ctx.command,
        using: ctx.usingExpr ?? null,
        withCheck: ctx.withCheckExpr ?? null,
        roles: ctx.roles,
        anonReachable: ctx.anonReachable,
      },
      context:
        'Supabase-compatible Postgres. The anon key ships in the client by design. A policy that effectively allows anon to read or write all rows is a data leak. Compare against the intent of per-user access like auth.uid() = user_id.',
      deterministicFindings: findings,
    },
    questions: {
      severity: choice(
        'Classify the security risk of this RLS policy for an app whose anon key is public.',
        {
          safe: 'Correctly scopes access (e.g. per-user / per-tenant); no broad exposure.',
          needs_review: 'Plausibly intentional but broad; a human should confirm the intent.',
          dangerous: 'Effectively public read or write of sensitive data, or bypasses RLS.',
        },
      ),
      publicReadAll: noul(
        'Does this policy effectively let the anonymous/public role read every row of the table (a USING(true)-equivalent)?',
        { true: 'Anon can read all rows', false: 'Access is meaningfully restricted' },
      ),
      exposesServiceRole: noul(
        'Does this policy or its grants expose the service_role / a full RLS bypass to untrusted callers?',
        {
          true: 'A privileged bypass is reachable by untrusted callers',
          false: 'Privileged access stays server-side',
        },
      ),
      exposureScale: score('If this is exposed, how sensitive is the data likely to be?', [
        'Trivial: public-by-design data (e.g. published content).',
        'Moderate: user-scoped but low-harm data.',
        'Sensitive: personal data, emails, private user content.',
        'Critical: credentials, tokens, payment or auth data.',
      ]),
    },
  });

  const sevAns = res.answers.severity;
  const readAns = res.answers.publicReadAll;
  const svcAns = res.answers.exposesServiceRole;
  const scaleAns = res.answers.exposureScale;
  const sevVerdict = isChoice(sevAns)
    ? decideChoice<PolicySeverity>(sevAns, { minConfidence: 0.7 })
    : { outcome: 'escalate' as const, decided: false, strength: 0, reason: 'no severity answer' };
  const publicReadAll = isNoul(readAns) && decideNoul(readAns, { yes: 0.75 }).outcome === 'yes';
  const exposesServiceRole =
    anonHasServiceRole || (isNoul(svcAns) && decideNoul(svcAns, { yes: 0.75 }).outcome === 'yes');
  const highSensitivity =
    isScore(scaleAns) && decideScore(scaleAns, { atOrAbove: 2 }).outcome === 'above';
  const hardDangerous = usingTrue || checkTrue || anonHasServiceRole;
  const severity: PolicySeverity | 'escalate' = hardDangerous
    ? 'dangerous'
    : (sevVerdict.outcome as PolicySeverity | 'escalate');
  const blockApply =
    severity === 'dangerous' ||
    severity === 'escalate' ||
    (severity === 'needs_review' && (publicReadAll || exposesServiceRole || highSensitivity));
  return {
    severity,
    blockApply,
    publicReadAll,
    exposesServiceRole,
    confidence: isChoice(sevAns) ? sevAns.confidence : 0,
    findings,
    reason: hardDangerous ? findings.join(' ') : sevVerdict.reason,
  };
}

export interface MigrationDiffContext {
  readonly summary: string;
  readonly statements: readonly string[];
  readonly touchesAuthOrStorage: boolean;
  readonly dropsOrTruncates: boolean;
}

export interface MigrationRiskVerdict {
  readonly risk: number;
  readonly requiresHumanApproval: boolean;
  readonly confidence: number;
  readonly reason: string;
}

/**
 * Judge whether a migration diff is risky enough to require a human gate before
 * `orion migrate`/`orion import` applies it. Destructive statements always gate.
 */
export async function judgeMigrationRisk(
  client: OpenJevClient,
  ctx: MigrationDiffContext,
): Promise<MigrationRiskVerdict> {
  if (ctx.dropsOrTruncates) {
    return {
      risk: 3,
      requiresHumanApproval: true,
      confidence: 1,
      reason: 'destructive statement (DROP/TRUNCATE) — always requires human approval',
    };
  }

  const res = await client.systemOne({
    state: { migration: ctx },
    questions: {
      risk: score('How risky is applying this migration to a live Postgres database?', [
        'Safe: additive only (new tables/columns/indexes), reversible.',
        'Moderate: alters existing columns or constraints; needs care.',
        'Risky: rewrites data, changes types, or touches auth/storage.',
        'Dangerous: potential data loss, lock storms, or auth lockout.',
      ]),
      needsHuman: noul(
        'Should a human approve this migration before it runs against production data?',
        {
          true: 'The blast radius or ambiguity warrants human sign-off',
          false: 'Safe to auto-apply with backups',
        },
      ),
    },
  });

  const riskAns = res.answers.risk;
  const humanAns = res.answers.needsHuman;
  const risk = isScore(riskAns) ? riskAns.score : 3;
  const needsHuman =
    ctx.touchesAuthOrStorage ||
    risk >= 2 ||
    (isNoul(humanAns) && decideNoul(humanAns, { yes: 0.6 }).outcome !== 'no');
  return {
    risk,
    requiresHumanApproval: needsHuman,
    confidence: isScore(riskAns) ? riskAns.confidence : 0,
    reason: ctx.touchesAuthOrStorage ? 'touches auth/storage' : `risk score ${risk.toFixed(2)}`,
  };
}

/**
 * The action an AI agent wants to take on the database.
 * Typically constructed from the agent's tool-use plan before execution.
 */
export interface AgentActionContext {
  /** Short label of the action type, e.g. "run_sql", "insert_rows", "delete_rows". */
  readonly actionType: string;
  /** The SQL or structured description of what the agent wants to do. */
  readonly description: string;
  /**
   * The agent's stated reasoning for taking this action (from the chain-of-thought
   * or tool-use output).
   */
  readonly agentRationale?: string;
  /** Tables affected, if known. */
  readonly affectedTables?: readonly string[];
  /**
   * True when the action is irreversible (e.g. DELETE without a backup, DROP).
   * Set this from static analysis; do not rely solely on otsone.
   */
  readonly irreversible: boolean;
  /** The user or role whose session the agent is operating under. */
  readonly actingAs: string;
  /**
   * Ambient context: what workflow spawned this agent, e.g.
   * "AI migration assistant running in the Scribase CLI".
   */
  readonly workflowContext?: string;
}

export type AgentActionDecision = 'allow' | 'block' | 'require_human_approval';

export interface AgentActionVerdict {
  readonly decision: AgentActionDecision;
  readonly confidence: number;
  /**
   * True when the agent's stated rationale does not match the described action
   * (the agent may be confused, hallucinating, or prompt-injected).
   */
  readonly rationaleAligned: boolean;
  /**
   * Blast-radius rating (0..3): how much damage if this action runs and is wrong?
   */
  readonly blastRadius: number;
  readonly reason: string;
}

/**
 * Screen an AI agent action before it executes against production data.
 *
 * Policy:
 * - Irreversible actions always require at minimum human approval.
 * - A misaligned rationale (agent confused or injected) always blocks.
 * - High blast-radius actions require human approval or block.
 *
 * This gate runs BEFORE the action, not after. Never skip it for irreversible ops.
 */
export async function judgeAgentAction(
  client: OpenJevClient,
  ctx: AgentActionContext,
): Promise<AgentActionVerdict> {
  // Hard rule: irreversible + no human in the loop -> block immediately.
  if (ctx.irreversible) {
    return {
      decision: 'require_human_approval',
      confidence: 1,
      rationaleAligned: true,
      blastRadius: 3,
      reason: 'irreversible action — always requires human approval before execution',
    };
  }

  const res = await client.systemOne({
    state: {
      action: {
        type: ctx.actionType,
        description: ctx.description,
        affectedTables: ctx.affectedTables ?? [],
        irreversible: ctx.irreversible,
        actingAs: ctx.actingAs,
        workflowContext: ctx.workflowContext ?? null,
      },
      agentRationale: ctx.agentRationale ?? null,
      note: 'An AI agent is about to take this action on a production Postgres database. Evaluate whether the action is safe to auto-approve, needs a human gate, or should be blocked outright.',
    },
    questions: {
      blastRadius: score('If this action runs and is incorrect, how much damage could result?', [
        'Negligible: read-only or easily reversible; no data at risk.',
        'Limited: affects a small set of rows; a backup restore fixes it.',
        'Significant: affects many rows or a critical table; recovery is costly.',
        'Catastrophic: could corrupt or destroy critical production data.',
      ]),
      rationaleAligned: noul(
        "Does the agent's stated rationale actually justify the described action? (Misalignment may indicate confusion, hallucination, or prompt injection.)",
        {
          true: 'Rationale clearly justifies this specific action',
          false: 'Rationale is absent, vague, or does not match the action',
        },
      ),
      recommendation: choice('What should the system do with this agent action request?', {
        allow: 'Safe to auto-execute without human review.',
        require_human_approval:
          'Action is plausible but the blast radius or novelty warrants a human sign-off.',
        block: 'Action should not proceed; it looks dangerous or misaligned.',
      }),
    },
  });

  const blastAns = res.answers.blastRadius;
  const rationaleAns = res.answers.rationaleAligned;
  const recAns = res.answers.recommendation;
  const blastRadius = isScore(blastAns) ? blastAns.score : 3;
  const confidence = isScore(blastAns) ? blastAns.confidence : 0;
  const rationaleAligned =
    !isNoul(rationaleAns) || decideNoul(rationaleAns, { yes: 0.6, no: 0.4 }).outcome !== 'no';

  // Hard rules after model judgment.
  if (!rationaleAligned) {
    return {
      decision: 'block',
      confidence,
      rationaleAligned: false,
      blastRadius,
      reason: 'agent rationale does not justify the action — blocked (possible misalignment)',
    };
  }

  const highBlast = isScore(blastAns)
    ? decideScore(blastAns, { atOrAbove: 2 }).outcome === 'above'
    : true;
  let decision: AgentActionDecision = 'require_human_approval';
  let reason = 'defaulted to human approval';
  if (isChoice(recAns)) {
    const v = decideChoice<AgentActionDecision>(recAns, { minConfidence: 0.75 });
    if (v.decided) {
      decision = v.outcome as AgentActionDecision;
      reason = v.reason;
    }
  }
  // Escalate any high-blast auto-allow to human approval.
  if (decision === 'allow' && highBlast) {
    decision = 'require_human_approval';
    reason = `overridden: blast radius ${blastRadius.toFixed(2)} too high for auto-allow`;
  }
  return { decision, confidence, rationaleAligned, blastRadius, reason };
}

export interface TableExposureContext {
  readonly tableName: string;
  readonly schema: string;
  /** All policies defined on this table, with their commands and using/check expressions. */
  readonly policies: ReadonlyArray<{
    readonly command: string;
    readonly usingExpr?: string;
    readonly withCheckExpr?: string;
    readonly roles: readonly string[];
  }>;
  /** True if ANY policy on this table uses USING(true) or WITH CHECK(true). */
  readonly hasPermissivePolicy: boolean;
  /** True if the table is part of the public-facing API (reachable via anon key). */
  readonly publicFacing: boolean;
  /**
   * Rough data classification for this table, as set by the developer or inferred
   * from column names (e.g. "user PII", "payment data", "public content").
   */
  readonly dataClassification?: string;
}

export interface SchemaExposureVerdict {
  /** 0..3 overall exposure risk for this table. */
  readonly exposureRisk: number;
  /** True when this table is a priority for immediate policy hardening. */
  readonly priorityForHardening: boolean;
  readonly confidence: number;
  readonly reason: string;
}

/**
 * Score one table's overall exposure across all its policies. Useful for a
 * studio-level "schema health" dashboard pass — call this for each table and
 * sort by `exposureRisk` descending to triage the most exposed tables first.
 */
export async function scoreSchemaExposure(
  client: OpenJevClient,
  ctx: TableExposureContext,
): Promise<SchemaExposureVerdict> {
  // Deterministic fast path: a permissive policy on a public-facing table is
  // immediately a priority regardless of model output.
  if (ctx.hasPermissivePolicy && ctx.publicFacing) {
    return {
      exposureRisk: 3,
      priorityForHardening: true,
      confidence: 1,
      reason: 'permissive policy (USING/CHECK true) on public-facing table',
    };
  }

  const res = await client.systemOne({
    state: {
      table: `${ctx.schema}.${ctx.tableName}`,
      publicFacing: ctx.publicFacing,
      dataClassification: ctx.dataClassification ?? 'unknown',
      hasPermissivePolicy: ctx.hasPermissivePolicy,
      policyCount: ctx.policies.length,
      policies: ctx.policies,
      note: 'Evaluate the overall access-control posture of this table relative to its data classification and public reachability.',
    },
    questions: {
      exposureRisk: score(
        'How exposed is this table to unauthorized access given its policies and public reachability?',
        [
          'Well-protected: policies are tight, data classification is low risk.',
          'Acceptable: minor gaps but no immediate exposure of sensitive data.',
          'Needs attention: gaps that could lead to data leakage under certain conditions.',
          'Critically exposed: unauthorized access to sensitive data is likely.',
        ],
      ),
      shouldHarden: noul("Should hardening this table's RLS policies be a near-term priority?", {
        true: 'Policy gaps combined with data sensitivity make this urgent',
        false: 'Acceptable posture; not an immediate priority',
      }),
    },
  });

  const riskAns = res.answers.exposureRisk;
  const hardenAns = res.answers.shouldHarden;
  const exposureRisk = isScore(riskAns) ? riskAns.score : 0;
  const confidence = isScore(riskAns) ? riskAns.confidence : 0;
  const priorityForHardening =
    exposureRisk >= 2 || (isNoul(hardenAns) && decideNoul(hardenAns, { yes: 0.65 }).outcome === 'yes');
  const riskVerdict = isScore(riskAns)
    ? decideScore(riskAns, { atOrAbove: 2 })
    : { outcome: 'escalate' as const, reason: 'no risk answer', decided: false, strength: 0 };
  return {
    exposureRisk,
    priorityForHardening,
    confidence,
    reason: riskVerdict.reason,
  };
}

// ---- Internal helpers -----------------------------------------------------

function normalize(expr: string | undefined): string {
  return (expr ?? '').trim().replace(/;$/, '').replace(/\s+/g, ' ').toLowerCase();
}

export { OpenJevClient };
/** @deprecated Use {@link OpenJevClient} instead. */
export { OpenJevClient as TypeSafeClient };
