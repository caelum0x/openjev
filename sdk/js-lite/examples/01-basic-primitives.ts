/**
 * Basic primitives: noul, choice, score.
 *
 * Demonstrates the three TypeSafe question types using the client's single-
 * question convenience methods. Each method makes one POST /v1/systemone call.
 *
 * Run: tsx examples/01-basic-primitives.ts
 * Requires: TYPESAFE_API_KEY in env (or .env file loaded before running).
 */

import { TypeSafeClient, noul, choice, score } from '../src/index.ts';
import { decideNoul, decideChoice, decideScore } from '../src/decide.ts';

const client = new TypeSafeClient();

// ---- 1. Noul: calibrated yes/no probability --------------------------------
//
// `client.noul()` returns the raw probability of "yes" (0..1). The closer to
// 0.5, the more genuinely uncertain the model is — NOT "medium intensity".
// Use decideNoul to map to a committed 'yes', 'no', or 'escalate'.

const email = {
  subject: 'Limited time: 80% off today only!!!',
  body: 'Click here to claim your prize. You have been selected as a winner.',
};

const spamAnswer = await client.noul(
  email,
  noul(
    'Is this email likely to be unsolicited commercial spam or a phishing attempt?',
    {
      true: 'Strong spam or phishing signals (urgency, prizes, suspicious links)',
      false: 'Looks like a legitimate email',
    },
  ),
);

const spamDecision = decideNoul(spamAnswer, { yes: 0.8, no: 0.2 });
console.log('Spam check:');
console.log('  p(spam):', spamAnswer.noul.toFixed(3));
console.log('  decision:', spamDecision.outcome);
console.log('  reason:', spamDecision.reason);
console.log();

// ---- 2. Choice: closed-set label --------------------------------------------
//
// `client.choice()` picks one of the supplied options and returns the choice key
// plus a confidence score (0..1). Set minConfidence high for consequential routing.

const supportTicket = {
  subject: 'I was charged twice this month',
  body: 'My credit card statement shows two charges of $29 on the same day. Please refund one.',
};

const categoryAnswer = await client.choice(
  supportTicket,
  choice(
    'What is the primary category of this support request?',
    {
      billing: 'Payment, charge, invoice, or refund issue.',
      technical: 'Bug, error, or unexpected product behavior.',
      account: 'Login, password, or account access problem.',
      feature: 'A request for new functionality.',
      other: 'Does not fit the above.',
    },
  ),
);

const categoryDecision = decideChoice(categoryAnswer, { minConfidence: 0.75 });
console.log('Support ticket category:');
console.log('  choice:', categoryAnswer.choice);
console.log('  confidence:', categoryAnswer.confidence.toFixed(3));
console.log('  decision:', categoryDecision.outcome);
console.log('  reason:', categoryDecision.reason);
console.log();

// ---- 3. Score: ordered position on a described scale -----------------------
//
// `client.score()` returns the probability-weighted position across the level
// descriptions (lowest=0, highest=N-1). Levels must be concrete and ordered.

const codeReview = {
  title: 'Add input validation to user signup',
  diff: `
    - const email = req.body.email;
    - const password = req.body.password;
    + const email = sanitize(req.body.email?.trim() ?? '');
    + const password = req.body.password;
    + if (!email || !isValidEmail(email)) throw new ValidationError('invalid email');
    + if (password.length < 8) throw new ValidationError('password too short');
  `,
};

const riskAnswer = await client.score(
  codeReview,
  score(
    'How risky is this code change from a security perspective?',
    [
      'No risk: defensive change that hardens the codebase.',
      'Low risk: minor change with negligible security impact.',
      'Medium risk: alters security logic; warrants careful review.',
      'High risk: could introduce a vulnerability or bypass existing defenses.',
    ],
  ),
);

const riskDecision = decideScore(riskAnswer, { atOrAbove: 2 });
console.log('Code review security risk:');
console.log('  score:', riskAnswer.score.toFixed(3), '(0=no risk, 3=high risk)');
console.log('  confidence:', riskAnswer.confidence.toFixed(3));
console.log('  decision:', riskDecision.outcome);
console.log('  reason:', riskDecision.reason);
