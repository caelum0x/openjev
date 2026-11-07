"""Train ``otsone-1``: OpenJev's own compact, CPU-runnable typed-decision model.

``otsone-1`` (family ``openjev``) is a *distinct* model, not a re-export of
anything:

* It is **not** Convai's ``laya`` -- that is a 421M ModernBERT-large decision
  model this repo runs natively on MLX (:mod:`laya_mlx.model`). ``otsone-1`` is
  trained from scratch here on a selectable backbone (``--backbone``):
  ``otsone-mini`` (MiniLM, default/offline), ``otsone-base`` (ModernBERT-base,
  primary), ``otsone-lite`` (DeBERTa-v3-xsmall, edge).
* It is **not** TypeSafe's ``jev`` -- that is a hosted cloud System One service.
  ``otsone-1`` runs fully local as an ONNX graph on the CPU ExecutionProvider.

**v2 architecture (docs/RESEARCH-OTSONE.md).** The SCORE head is a CORN
rank-consistent ordinal head (K-1 conditional sigmoids on the pooled [CLS]),
exported as a second ``corn_logits`` ONNX output the runtime consumes; training
is calibration-native (label smoothing + Dual-Focal + a strictly-proper Brier
term) with per-type temperature scaling (T_choice/T_score/T_noul, never one
global T); the corpus is extended by an 8-axis synthetic generator
(:mod:`laya_mlx.data_gen`) with an optional env-gated LLM-teacher soft-label
distillation hook.

What it shares with both is the wire contract: the exact
``[CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]``
sequence this package builds (:func:`laya_mlx.common.build_sequence`) and the
per-option marker logits :class:`laya_mlx.server.OnnxEngine` reads. So a trained
``otsone-1`` loads and serves through the very same ONNX backend as an exported
``laya`` checkpoint -- no bespoke runtime.

Backbone: ``sentence-transformers/all-MiniLM-L6-v2`` (Apache-2.0, 384-dim, BERT
WordPiece tokenizer whose ``[CLS]/[SEP]/[PAD]/[MASK]`` are what
:class:`laya_mlx.tokenizer.Tokenizer` needs). A bidirectional pass lets every
option's ``[MASK]`` marker attend to its option text and the state; a shared
scorer head (plus a per-qtype embedding) maps each marker's contextual vector to
one logit. The whole stack is fine-tuned with a single cross-entropy objective
(choice/score target = correct index, noul target = P(true)) on a synthetic
typed-decision corpus, optionally augmented with the OpenJev gold cases.

Output (``models/otsone-base/`` by default) is the exact sidecar checkpoint shape
:class:`laya_mlx.server.OnnxEngine` loads -- ``model.onnx``, ``rl_agent_config.json``,
``encoder/config.json``, ``tokenizer/`` -- plus a ``model_card.json`` naming the
model and holding metric placeholders that :mod:`laya_mlx.eval_gold` fills in.

Torch / sentence-transformers / onnxruntime are imported lazily inside
:func:`main`, so importing this module never needs the ``[train]`` extra and it
stays importable on CI. Training is CPU-runnable on the tiny synthetic corpus;
the one online step is the first MiniLM download (a ``pip``/network step), which
fails with a clear, actionable message when offline.

Regenerate::

    laya-mlx distill --out models/otsone-base
    laya-mlx eval --model models/otsone-base
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import random
from pathlib import Path
from typing import Optional

from . import data_gen
from .calibration import fit_temperature_corn, fit_temperature_nll
from .common import QTYPES, render_options

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

MODEL_NAME = "otsone-1"
MODEL_FAMILY = "openjev"
TRAINED_BY = "openjev"
ENCODER_NAME = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_OUT = "models/otsone-base"

# --- Selectable backbone tiers (docs/RESEARCH-OTSONE.md section 2) ----------
# otsone-mini is the default so the offline MiniLM baseline keeps working with
# no network beyond the first cached download; otsone-base is the researched
# primary; otsone-lite is the CPU/edge tier. Each maps a HF encoder id to its
# hidden dimension. The head architecture is identical across tiers (encoder
# swap only), matching the "extend, don't rewrite" thesis.
BACKBONES = {
    "otsone-mini": {
        "encoder": "sentence-transformers/all-MiniLM-L6-v2",
        "hidden": 384,
        "tier": "offline baseline (default)",
    },
    "otsone-base": {
        "encoder": "answerdotai/ModernBERT-base",
        "hidden": 768,
        "tier": "primary (GPU / Apple Silicon)",
    },
    "otsone-lite": {
        "encoder": "microsoft/deberta-v3-xsmall",
        "hidden": 384,
        "tier": "edge (CPU-only / <256MB RAM)",
    },
}
DEFAULT_BACKBONE = "otsone-mini"

# The CORN ordinal SCORE head emits a fixed number of thresholds so the ONNX
# graph shape is static; a K-level rubric consumes the first K-1 of them. 12
# covers every rubric in the corpus and the gold set with headroom.
CORN_LEVELS = 12

# Calibration-native training hyper-parameters (docs section 3). Label smoothing
# and the strictly-proper Brier term make the training objective and the
# calibration goal stop diverging, so post-hoc temperature only fine-tunes.
LS_EPS = 0.10
FOCAL_GAMMA = 0.5
BRIER_WEIGHT = 0.05
W_CHOICE, W_SCORE, W_NOUL = 0.4, 0.3, 0.3
KD_ALPHA = 0.3  # weight on teacher soft-label KL for discriminative rows

# ---------------------------------------------------------------------------
# Synthetic typed-decision corpus.
# Each entry is (state, qtype, instructions, criteria, target_index).
# ---------------------------------------------------------------------------

DEPT = {
    "returns": "Exchanges, refunds, wrong or damaged items",
    "shipping": "Delivery status, delays, lost packages",
    "billing": "Charges, invoices, payment problems",
    "technical": "Bugs, errors, outages, things not working",
    "sales": "New purchases, upgrades, pricing questions",
    "account": "Login, password, profile and settings",
}
DEPT_STATES = {
    "returns": [
        "My running shoes arrived in the wrong size, can I swap them for a size 10?",
        "The jacket I ordered is damaged, I want to send it back for a refund.",
        "Wrong item was delivered, I need to exchange it for the one I ordered.",
        "I changed my mind about the blender, how do I return it?",
        "These headphones are faulty, I'd like my money back.",
        "Can I get a refund for the dress that doesn't fit?",
    ],
    "shipping": [
        "Where is my package? It was supposed to arrive three days ago.",
        "My order has been stuck in transit for a week, any update on delivery?",
        "The tracking says delivered but nothing came, my parcel is lost.",
        "How long until my order ships out?",
        "My delivery is late, when will it get here?",
        "The courier never showed up with my package.",
    ],
    "billing": [
        "I see two charges on my card for the same order.",
        "Why was I billed twice this month? Please refund the duplicate.",
        "My invoice shows the wrong amount, the payment is incorrect.",
        "You charged my card but the order was cancelled.",
        "I need a copy of my invoice for accounting.",
        "There is an unexpected fee on my statement I don't recognise.",
    ],
    "technical": [
        "The app crashes every time I open the reports page.",
        "I keep getting a 500 error when I try to check out.",
        "The export button does nothing, it seems broken.",
        "Your website won't load at all today, is there an outage?",
        "The sync feature stopped working after the last update.",
        "I found a bug: the dashboard shows the wrong totals.",
    ],
    "sales": [
        "I'd like to upgrade to the annual plan, what does it cost?",
        "Do you offer a discount for buying ten licences?",
        "I'm interested in purchasing the pro tier for my team.",
        "Can you tell me the price difference between the plans?",
        "We want to buy your product for our whole company.",
        "Is there a trial before I commit to a new subscription?",
    ],
    "account": [
        "I can't log in, my password reset email never arrives.",
        "How do I change the email address on my profile?",
        "I'm locked out of my account and need to get back in.",
        "Where do I update my notification settings?",
        "My two-factor authentication is not letting me sign in.",
        "I want to delete my account and all my data.",
    ],
}

TONE = ["calm", "frustrated", "angry"]
TONE_STATES = {
    "calm": [
        "Hi, just checking in on my order status when you have a moment, thanks!",
        "No rush at all, I was wondering about the return policy.",
        "Thanks for your help earlier, one small follow-up question.",
        "Could you let me know the delivery date? Appreciate it.",
        "Hope you're well! Quick question about my recent order.",
        "All good on my end, just curious when this will ship.",
    ],
    "frustrated": [
        "This is the second time I've had to ask about my refund.",
        "I've been waiting far too long for a simple answer.",
        "It's really annoying that the item arrived in the wrong size again.",
        "I'm getting tired of the delays with this order.",
        "Shoes arrived two weeks late and in the wrong size. Also I see two "
        "charges on my card. What are you going to do about this?",
        "My order is late, the item is wrong, and I was double charged. What are "
        "you going to do about it?",
        "Two weeks late, wrong size, and an extra charge. I'd like this sorted out.",
        "Late delivery, damaged item, and no reply to my last message. How is "
        "this going to be fixed?",
        "The package came late, the wrong item was inside, and now I have to "
        "chase you. Please resolve this.",
        "I've had three separate problems with this one order and still nothing "
        "is fixed.",
    ],
    "angry": [
        "This is absolutely unacceptable, I want this fixed now!",
        "I am furious, you charged me twice and nobody will help.",
        "Worst service ever, I demand a refund immediately.",
        "I'm done with this, cancel everything right now.",
        "This is a disgrace, I will never buy from you again!",
        "Absolutely appalling, fix this immediately or I'm reporting you.",
    ],
}

RETURN_REASON = {
    "wrong_size": "The item doesn't fit",
    "wrong_item": "A different product was delivered",
    "damaged": "The item arrived broken or faulty",
    "changed_mind": "The item is fine, the customer no longer wants it",
    "other": "A return reason that fits none of the above",
}
RETURN_REASON_STATES = {
    "wrong_size": [
        "The shoes are too small, I need a bigger size.",
        "This shirt doesn't fit me, it's way too tight.",
        "Ordered a medium but it fits like an extra small.",
    ],
    "wrong_item": [
        "I ordered a blue mug but received a red kettle.",
        "You sent me the wrong product entirely.",
        "This is not what I ordered, different item in the box.",
    ],
    "damaged": [
        "The screen arrived cracked and unusable.",
        "The package was crushed and the item is broken.",
        "It came faulty, it won't even turn on.",
    ],
    "changed_mind": [
        "The item is fine but I simply don't want it anymore.",
        "I changed my mind, please take it back.",
        "Nothing wrong with it, I just no longer need it.",
    ],
    "other": [
        "I'd like to return this for a reason not listed.",
        "It's a bit of everything, hard to say exactly why.",
        "Just want to send it back, no particular category.",
    ],
}

REQUEST_TYPE = {
    "refund": "The customer wants money returned.",
    "rebooking": "The customer wants a replacement or reschedule.",
    "information": "The customer is asking for information only.",
}
REQUEST_TYPE_STATES = {
    "refund": [
        "My flight was cancelled, can I get a refund?",
        "I want my money back for the cancelled order.",
        "Please refund the duplicate charge.",
    ],
    "rebooking": [
        "My flight was cancelled, can you put me on the next one?",
        "Can I reschedule my delivery to next week?",
        "I'd like a replacement item instead of a refund.",
    ],
    "information": [
        "What time does your store open on Sunday?",
        "Just wondering how the warranty works.",
        "Can you tell me if this comes in blue?",
    ],
}

RETURN_TOPIC = {
    "return_policy": {
        "what": "Whether and how an item can be returned",
        "not_for": "Progress of a return already sent",
    },
    "return_status": {
        "what": "Progress of a return already sent",
        "not_for": "Whether and how an item can be returned",
    },
}
RETURN_TOPIC_STATES = {
    "return_policy": [
        "Can I return shoes I've worn once?",
        "How long do I have to return an order?",
        "What's your policy on returning opened items?",
        "Am I allowed to return a gift without a receipt?",
        "Do you accept returns on sale items?",
        "Is there a deadline to send something back?",
    ],
    "return_status": [
        "I sent the shoes back a week ago, when do I get my money?",
        "I sent the shoes back a week ago. When do I get my money?",
        "Has my return arrived yet?",
        "When will my refund be paid now that I've shipped it back?",
        "I already mailed the item back, where is my refund?",
        "I dropped off the return two days ago, has it been processed?",
        "The parcel was returned last Monday, any update on my money?",
    ],
}

SEVERITY = [
    "Cosmetic; no impact to functionality",
    "Broken or degraded feature, but workaround exists",
    "Blocking issue; no workaround exists",
]
SEVERITY_STATES = {
    0: [
        "The export button is misaligned by a few pixels. Everything still works.",
        "There's a small typo in the footer, otherwise fine.",
        "The icon colour looks slightly off but the feature works.",
    ],
    1: [
        "The PDF export does nothing in Safari, but CSV export still works.",
        "Search is broken on mobile, though you can still use the desktop site.",
        "Image upload fails, but you can attach a link as a workaround.",
    ],
    2: [
        "Nobody can log in. Every attempt returns a 500 error.",
        "The whole checkout is down, no one can pay.",
        "The app crashes on launch for everyone, completely unusable.",
    ],
}

URGENCY = ["not urgent", "soon", "critical"]
URGENCY_STATES = {
    0: [
        "Whenever you get a chance, no hurry on this.",
        "Just a minor question for some time next month.",
        "Low priority, feel free to get to it later.",
    ],
    1: [
        "I'd like this sorted in the next day or two if possible.",
        "It's fairly time-sensitive, hoping to resolve soon.",
        "Please look into this by end of week.",
    ],
    2: [
        "This is an emergency, our production is down right now.",
        "Critical outage, we need help immediately.",
        "Everything is broken and customers are affected, urgent!",
    ],
}

# noul concepts: (instructions, criteria, positive_states, negative_states).
NOUL_TASKS = [
    (
        "Does this message request a refund?",
        None,
        [
            "Please refund the duplicate charge on my card.",
            "I want my money back for the cancelled flight.",
            "Can I get a refund for these shoes that don't fit?",
            "Refund me for the order that never arrived.",
            "My flight was cancelled. Can I get a refund?",
            "I'd like a refund since the item was faulty.",
            "Please return my money, the product broke on day one.",
            "Can you issue a refund for the extra charge?",
            "I need a full refund for this cancelled order.",
            "Give me my money back for the item I never received.",
        ],
        [
            "Thanks, just confirming the order shipped. No action needed.",
            "What time does your store close today?",
            "Can you help me reschedule my delivery?",
            "Just wanted to say the product works great.",
            "Where is my package right now?",
            "How do I change my shipping address?",
            "Is this available in a larger size?",
            "Can you send me a copy of the manual?",
            "I'd like to upgrade my plan to annual.",
            "Just confirming you received my return.",
        ],
    ),
    (
        "Is the customer asking for a human agent?",
        None,
        [
            "Can I please just talk to a real person?",
            "I want to speak to a human, not a bot.",
            "Please connect me with a live agent.",
            "Get me a real support representative now.",
            "I have asked three times now. Can I please just talk to a real person?",
            "Stop with the automated replies, I need an actual human.",
            "Transfer me to a person who can actually help.",
            "Is there any way to reach a real support agent?",
            "I'd rather explain this to a human being.",
            "Can someone real call me back about this?",
        ],
        [
            "Where can I find my invoice?",
            "What's the status of my order?",
            "How do I reset my password?",
            "Does this come with a warranty?",
            "When will my package arrive?",
            "Can I return this item for a refund?",
            "How long does shipping usually take?",
            "What's your return policy?",
            "Is the pro plan worth the upgrade?",
            "Thanks, that answered my question.",
        ],
    ),
    (
        "Has the customer contacted support about this before?",
        {
            "true": "Mentions a prior attempt, ticket, or that they have asked before",
            "false": "No sign of any previous contact",
        },
        [
            "I have asked three times now about this refund.",
            "This is my second email regarding the same issue.",
            "As per my previous ticket, the problem is still not fixed.",
            "I called yesterday and was told it would be resolved.",
            "I have asked three times now. Can I please just talk to a real person?",
            "Following up again on the case I opened last week.",
            "Like I said in my earlier message, this is still broken.",
            "I already reported this once and nothing changed.",
            "My third time writing in about the same problem.",
            "You told me last time it would be sorted, it wasn't.",
        ],
        [
            "Hi, I have a quick question about my order.",
            "First time reaching out, hoping you can help.",
            "Just placed an order and wondering about delivery.",
            "New here, how does the return process work?",
            "Hello, I'd like to ask about your warranty.",
            "Quick one: does this ship internationally?",
            "I just bought this and have a question.",
            "Wondering if you can help me pick a size.",
            "Good morning, a question about my recent purchase.",
            "Can you tell me when the sale ends?",
        ],
    ),
    (
        "Is this unsolicited spam or a scam?",
        {
            "true": "Prize, crypto, phishing, unsubscribe bait, fake urgency",
            "false": "A legitimate customer or coworker message",
        },
        [
            "Congratulations! You won a $2,500 crypto prize, click to claim within 24 hours.",
            "URGENT: verify your account now or it will be suspended, click this link.",
            "You've been selected for a free iPhone, just pay shipping today!",
            "Make $5000 a week from home, reply now to start earning.",
            "Congratulations! You have been selected as a winner of a $2,500 crypto "
            "prize. Click here to claim within 24 hours.",
            "Your parcel is held, pay a small fee here to release it now.",
            "Final notice: claim your reward before it expires tonight.",
            "Hot singles in your area want to chat, click now.",
        ],
        [
            "Hi, my order arrived damaged, can you help me return it?",
            "Following up on the invoice from last week.",
            "Could you confirm my delivery address is correct?",
            "Thanks for the quick reply, that resolved my issue.",
            "I have a question about my subscription renewal.",
            "The size runs small, can I exchange it?",
            "Please update my email on file.",
            "When will the item be back in stock?",
        ],
    ),
    (
        "Is the customer expressing dissatisfaction or a complaint?",
        None,
        [
            "This is unacceptable, I'm very disappointed with the service.",
            "I'm frustrated that my problem still isn't fixed.",
            "Terrible experience, the item was broken on arrival.",
            "I'm unhappy about being charged twice.",
            "This has been a really poor experience overall.",
            "I'm not satisfied with how this was handled.",
        ],
        [
            "Thanks so much, everything works perfectly!",
            "Just a quick question about the delivery date.",
            "Great product, wondering if there's an upgrade.",
            "Appreciate the help, all good now.",
            "Loving the new features, nice work!",
            "No complaints here, just a small question.",
        ],
    ),
    (
        "Is the customer asking a question?",
        None,
        [
            "What time does your store open on Sunday?",
            "How do I track my order?",
            "Can you tell me if this comes in blue?",
            "Which plan includes priority support?",
            "Where do I enter a discount code?",
            "Is there a warranty on this item?",
        ],
        [
            "Please cancel my subscription immediately.",
            "I am returning this item today.",
            "Here is my updated address.",
            "Thanks, no further action needed.",
            "I want a refund for this order.",
            "Just letting you know the parcel arrived.",
        ],
    ),
    (
        "Does the customer want to cancel?",
        None,
        [
            "Please cancel my subscription.",
            "I'd like to cancel my order before it ships.",
            "Cancel my plan, I no longer need it.",
            "Stop my membership at the end of the month.",
            "I want to close my account and cancel everything.",
            "Please cancel the recurring charge.",
        ],
        [
            "I'd like to upgrade my subscription.",
            "When will my order arrive?",
            "Can I change the delivery date?",
            "Thanks, everything looks good.",
            "How do I add another user to my plan?",
            "Is there a discount for annual billing?",
        ],
    ),
]

# Instruction paraphrases keep the model from binding to one exact wording; the
# noul instruction is the only semantic signal (options are contentless).
CHOICE_INSTR = {
    "dept": [
        "Which team should handle this?",
        "Which department should this go to?",
        "Who should handle this request?",
    ],
    "tone": ["What is the customer's tone?", "How would you describe the customer's tone?"],
    "reason": ["If the customer wants to return something, why?", "Why is the customer returning it?"],
    "request": ["What is the main request?", "What is the customer primarily asking for?"],
    "topic": ["Which returns topic is the customer asking about?", "Which returns topic applies?"],
}
SEVERITY_INSTR = ["How severe is the reported issue?", "How bad is this bug?"]
URGENCY_INSTR = ["How urgent is this request?", "What is the urgency level?"]


def build_corpus(seed: int = 13):
    """Build the synthetic ``(state, qtype, instructions, criteria, target)`` corpus."""
    rng = random.Random(seed)
    data = []

    def choice_examples(states_by_label, full_criteria, instrs, repeats=1, allow_null=False):
        labels = list(full_criteria)
        for label, states in states_by_label.items():
            for st in states:
                for _ in range(repeats):
                    others = [option_label for option_label in labels if option_label != label]
                    rng.shuffle(others)
                    k = rng.randint(1, len(others))
                    subset = others[:k] + [label]
                    rng.shuffle(subset)
                    if allow_null and rng.random() < 0.5:
                        crit = {option_label: None for option_label in subset}
                    else:
                        crit = {option_label: full_criteria[option_label] for option_label in subset}
                    data.append((st, "choice", rng.choice(instrs), crit, subset.index(label)))

    choice_examples(DEPT_STATES, DEPT, CHOICE_INSTR["dept"], repeats=3)
    choice_examples(
        TONE_STATES, {label: None for label in TONE}, CHOICE_INSTR["tone"], repeats=5, allow_null=True
    )
    choice_examples(RETURN_REASON_STATES, RETURN_REASON, CHOICE_INSTR["reason"], repeats=3)
    choice_examples(REQUEST_TYPE_STATES, REQUEST_TYPE, CHOICE_INSTR["request"], repeats=3)
    choice_examples(RETURN_TOPIC_STATES, RETURN_TOPIC, CHOICE_INSTR["topic"], repeats=6)

    for label, states in SEVERITY_STATES.items():
        for st in states:
            for _ in range(4):
                data.append((st, "score", rng.choice(SEVERITY_INSTR), list(SEVERITY), label))
    for label, states in URGENCY_STATES.items():
        for st in states:
            for _ in range(4):
                data.append((st, "score", rng.choice(URGENCY_INSTR), list(URGENCY), label))

    for instr, crit, pos, neg in NOUL_TASKS:
        for st in pos:
            for _ in range(3):
                data.append((st, "noul", instr, crit, 1))
        for st in neg:
            for _ in range(3):
                data.append((st, "noul", instr, crit, 0))

    rng.shuffle(data)
    return data


def find_gold(explicit: Optional[str] = None) -> Optional[Path]:
    """Locate the OpenJev gold cases, if reachable; None when not found."""
    if explicit:
        p = Path(explicit).expanduser()
        return p if p.is_file() else None
    here = Path(__file__).resolve()
    candidates = [
        here.parent.parent / "engine" / "gold.json",
        here.parent.parent / "benchmarks" / "gold.json",
        # Real repo layout: otsone/ is a direct child of the openjev/ checkout,
        # and engine/gold.json is a plain sibling of otsone/ one level up
        # (openjev/engine/gold.json) -- NOT nested under an extra "openjev"
        # segment. Confirmed by actually running `otsone distill` 2026-11-07.
        here.parent.parent.parent / "engine" / "gold.json",
        here.parent.parent.parent / "openjev" / "engine" / "gold.json",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


def add_gold_examples(gold_path: Path, data: list) -> int:
    """Append the gold cases as labelled training targets. Returns count added."""
    gold = json.loads(gold_path.read_text())
    before = len(data)
    for g in gold:
        state = g["state"]
        for e in g["expect"]:
            if "choice" in e:
                q = g["questions"][e["choice"]["id"]]
                labels = list(q["criteria"])
                data.append(
                    (state, "choice", q["instructions"], q["criteria"], labels.index(e["choice"]["value"]))
                )
            elif "noul" in e:
                q = g["questions"][e["noul"]["id"]]
                data.append((state, "noul", q["instructions"], q.get("criteria"), 1 if "min" in e["noul"] else 0))
            elif "score" in e:
                q = g["questions"][e["score"]["id"]]
                mid = (e["score"].get("min", 0) + e["score"].get("max", len(q["criteria"]) - 1)) / 2
                data.append((state, "score", q["instructions"], list(q["criteria"]), int(round(mid))))
    return len(data) - before


def to_question_def(qtype: str, instructions, criteria) -> dict:
    """Build a public question definition for a corpus row."""
    if isinstance(instructions, str):
        ins = instructions
    else:
        ins = json.dumps(instructions)
    if qtype == "choice":
        return {"type": "choice", "instructions": ins, "criteria": criteria}
    if qtype == "score":
        return {"type": "score", "instructions": ins, "criteria": criteria}
    return {"type": "noul", "instructions": ins, **({"criteria": criteria} if criteria else {})}


def encode(tok, state, qtype, instructions, criteria, max_len=512, head_max_len=192):
    """Encode one row into ``(ids, markers, qtype_index)`` via this package's prompt code."""
    from .common import build_sequence
    from .server import to_internal  # package's validator (MLX-free)

    q = to_internal(to_question_def(qtype, instructions, criteria))
    ids, markers = build_sequence(tok, state, q, max_len, head_max_len)
    if len(markers) != len(render_options(q)):
        return None
    return ids, markers, QTYPES[qtype]


def _decision_loss(torch, F, logits, corn_logits, mmask, qt, tgt, soft, has_soft):
    """Combined calibration-native multi-task loss (docs section 3).

    ``0.4*L_choice + 0.3*L_CORN + 0.3*L_noul``. CHOICE/NOUL use label-smoothed
    cross-entropy with a Dual-Focal modulation (calibrates the whole
    distribution, not just the argmax) plus a small strictly-proper Brier term
    and an optional teacher-KD KL. SCORE uses the rank-consistent CORN
    conditional-BCE ordinal loss on the CLS threshold logits.
    """
    eps = LS_EPS
    is_score = qt == 1
    nvalid = mmask.sum(1).clamp(min=1)

    # --- discriminative (choice/noul) marker head -------------------------
    logp = torch.log_softmax(logits, dim=1)
    p = logp.exp()
    onehot = torch.zeros_like(logits).scatter(1, tgt[:, None], 1.0)
    smooth = (1.0 - eps) * onehot + eps * mmask.float() / nvalid[:, None].float()
    ce = -(smooth * logp).sum(1)
    p_t = p.gather(1, tgt[:, None]).squeeze(1)
    p_other = p.masked_fill(onehot.bool(), -1.0).masked_fill(~mmask, -1.0)
    p_j = p_other.max(1).values.clamp(min=0.0)
    dfl = (1.0 - (p_t - p_j)).clamp(min=0.0) ** FOCAL_GAMMA
    brier_rows = (((p - smooth) * mmask.float()) ** 2).sum(1)
    disc_rows = dfl * ce + BRIER_WEIGHT * brier_rows

    if bool(has_soft.any()):
        # KL(teacher || student) over valid options; soft is a per-row PMF.
        kd = (soft * (soft.clamp(min=1e-9).log() - logp)) * mmask.float()
        disc_rows = disc_rows + KD_ALPHA * has_soft.float() * kd.sum(1)

    def masked_mean(values, mask):
        denom = mask.sum()
        if float(denom) <= 0:
            return values.new_zeros(())
        return (values * mask).sum() / denom

    choice_term = masked_mean(disc_rows, (qt == 0).float())
    noul_term = masked_mean(disc_rows, (qt == 2).float())

    # --- CORN ordinal score head ------------------------------------------
    thresholds = corn_logits.shape[1]
    levels = torch.arange(thresholds, device=logits.device)
    tgt_exceed = (tgt[:, None] > levels[None, :]).float()
    valid_thr = levels[None, :] < (nvalid[:, None] - 1)
    conditional = tgt[:, None] >= levels[None, :]  # CORN subset {y >= k}
    score_mask = (valid_thr & conditional & is_score[:, None]).float()
    bce = F.binary_cross_entropy_with_logits(corn_logits, tgt_exceed, reduction="none")
    denom = score_mask.sum().clamp(min=1.0)
    score_term = (bce * score_mask).sum() / denom

    return W_CHOICE * choice_term + W_NOUL * noul_term + W_SCORE * score_term


def _require_training_deps():
    """Import the training stack, or raise a clear, actionable error."""
    try:
        import numpy as np  # noqa: F401
        import torch  # noqa: F401
        import torch.nn.functional  # noqa: F401
        from transformers import AutoConfig, AutoModel, AutoTokenizer  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            "otsone training needs the [train] extra (torch + transformers/"
            "sentence-transformers + onnxruntime). Install with:\n"
            "    pip install 'laya-mlx[train]'\n"
            f"Import failed: {type(exc).__name__}: {exc}"
        )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="laya-mlx distill", description="Train otsone-1")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument(
        "--backbone",
        default=DEFAULT_BACKBONE,
        choices=sorted(BACKBONES),
        help="Encoder tier: otsone-mini (MiniLM, default/offline), otsone-base "
        "(ModernBERT-base, primary), otsone-lite (DeBERTa-v3-xsmall, edge)",
    )
    ap.add_argument("--epochs", type=int, default=14)
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--head-lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--gold", help="Path to gold.json to fold into training (auto-detected if unset)")
    ap.add_argument("--no-gold", action="store_true", help="Do not fold gold cases into training")
    ap.add_argument(
        "--no-synthetic",
        action="store_true",
        help="Skip the 8-axis synthetic corpus (laya_mlx.data_gen)",
    )
    ap.add_argument("--synthetic-per-axis", type=int, default=12, help="Rows per generation axis")
    ap.add_argument(
        "--no-teacher",
        action="store_true",
        help="Disable teacher soft-label distillation (KD); train on hard labels only",
    )
    args = ap.parse_args(argv)

    backbone = BACKBONES[args.backbone]
    encoder_name = backbone["encoder"]

    _require_training_deps()
    import numpy as np
    import torch
    import torch.nn.functional as F
    from transformers import AutoConfig, AutoModel, AutoTokenizer

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(
        f"[otsone] training {MODEL_NAME} (family={MODEL_FAMILY}) backbone={args.backbone} "
        f"[{backbone['tier']}] device={device} encoder={encoder_name}"
    )

    out = Path(args.out).expanduser()
    tok_dir = out / "tokenizer"
    tok_dir.mkdir(parents=True, exist_ok=True)
    try:
        hf_tok = AutoTokenizer.from_pretrained(encoder_name)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            f"Could not obtain the '{args.backbone}' backbone tokenizer ({encoder_name}). This "
            f"first step needs network access to the Hugging Face Hub (or a local cache). If you "
            f"are offline, pick a cached backbone (e.g. --backbone otsone-mini).\n"
            f"Underlying error: {type(exc).__name__}: {exc}"
        )
    hf_tok.save_pretrained(str(tok_dir))
    # laya_mlx.tokenizer.Tokenizer needs only tokenizer.json + tokenizer_config.json.
    for extra in ("special_tokens_map.json", "vocab.txt"):
        p = tok_dir / extra
        if p.exists():
            p.unlink()

    from .tokenizer import Tokenizer

    tok = Tokenizer(tok_dir)

    corpus = build_corpus(args.seed)
    gold_added = 0
    if not args.no_gold:
        gold_path = find_gold(args.gold)
        if gold_path is not None:
            gold_added = add_gold_examples(gold_path, corpus)
            print(f"[otsone] folded {gold_added} gold targets from {gold_path}")
        else:
            print("[otsone] no gold.json reachable; training on synthetic + base corpus")

    synthetic_added = 0
    if not args.no_synthetic:
        synth = data_gen.build_synthetic_corpus(args.seed, per_axis=args.synthetic_per_axis)
        corpus.extend(synth)
        synthetic_added = len(synth)
        print(f"[otsone] added {synthetic_added} synthetic rows across {len(data_gen.AXES)} axes")

    encoded = []
    sources = []
    for row in corpus:
        state, qtype, instructions, criteria, target = row
        e = encode(tok, state, qtype, instructions, criteria)
        if e is None:
            continue
        ids, markers, qt = e
        if target >= len(markers):
            continue
        encoded.append([ids, markers, qt, target, None])
        sources.append(row)
    print(f"[otsone] training examples: {len(encoded)}")
    if not encoded:
        raise SystemExit("No training examples were produced; aborting.")

    # Teacher soft labels (KD "dark knowledge"): a live LLM teacher when
    # OTSONE_TEACHER_API_KEY is set, otherwise the deterministic ordinal-aware
    # fallback. Either way every row gets a distribution, so training never
    # stalls on a teacher gap; KD is applied to the discriminative heads.
    if not args.no_teacher:
        option_counts = [len(r[1]) for r in encoded]
        soft = data_gen.soft_labels_for(sources, option_counts)
        for i, r in enumerate(encoded):
            r[4] = soft.get(i)
        origin = "live teacher" if data_gen.teacher_available() else "deterministic fallback"
        print(f"[otsone] soft labels via {origin} for {len(soft)} rows")

    try:
        encoder = AutoModel.from_pretrained(encoder_name)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            f"Could not download the '{args.backbone}' backbone weights ({encoder_name}); this "
            f"needs network access on first run. If offline, use a cached backbone "
            f"(--backbone otsone-mini). Error: {type(exc).__name__}: {exc}"
        )
    dim = encoder.config.hidden_size

    class Otsone(torch.nn.Module):
        """Backbone + shared marker scorer + per-qtype embedding + CORN score head.

        The marker scorer serves CHOICE and NOUL (one logit per option marker);
        the CORN head reads the pooled [CLS] vector and emits ``CORN_LEVELS-1``
        rank-consistent ordinal thresholds for SCORE. ``forward`` returns both so
        the ONNX graph carries a ``corn_logits`` output the runtime consumes.
        """

        def __init__(self, enc):
            super().__init__()
            self.encoder = enc
            self.type_emb = torch.nn.Embedding(3, dim)
            self.scorer = torch.nn.Sequential(
                torch.nn.LayerNorm(dim),
                torch.nn.Linear(dim, dim),
                torch.nn.GELU(),
                torch.nn.Linear(dim, 1),
            )
            self.corn = torch.nn.Linear(dim, CORN_LEVELS - 1)
            torch.nn.init.zeros_(self.type_emb.weight)

        def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
            am = attention_mask.to(torch.long)
            h = self.encoder(input_ids=input_ids, attention_mask=am).last_hidden_state
            h = h + self.type_emb(qtype).unsqueeze(1)
            idx = marker_pos.clamp(min=0).unsqueeze(-1).expand(-1, -1, h.size(-1))
            markers = torch.gather(h, 1, idx)
            logits = self.scorer(markers).squeeze(-1)
            neg = torch.full_like(logits, -1e4)
            logits = torch.where(marker_mask.to(torch.bool), logits, neg)
            corn_logits = self.corn(h[:, 0])
            return logits, corn_logits

    model = Otsone(encoder).to(device)

    def collate(batch):
        n = len(batch)
        length = max(len(b[0]) for b in batch)
        count = max(2, max(len(b[1]) for b in batch))
        input_ids = np.full((n, length), tok.pad_token_id, dtype=np.int64)
        attn = np.zeros((n, length), dtype=bool)
        mpos = np.zeros((n, count), dtype=np.int64)
        mmask = np.zeros((n, count), dtype=bool)
        qt = np.zeros((n,), dtype=np.int64)
        tgt = np.zeros((n,), dtype=np.int64)
        soft = np.zeros((n, count), dtype=np.float32)
        has_soft = np.zeros((n,), dtype=bool)
        for i, item in enumerate(batch):
            ids, markers, q, target, soft_dist = item[0], item[1], item[2], item[3], item[4]
            input_ids[i, : len(ids)] = ids
            attn[i, : len(ids)] = True
            mpos[i, : len(markers)] = markers
            mmask[i, : len(markers)] = True
            qt[i] = q
            tgt[i] = target
            if soft_dist is not None and len(soft_dist) == len(markers):
                soft[i, : len(soft_dist)] = soft_dist
                has_soft[i] = True

        def move(a):
            return torch.from_numpy(a).to(device)

        return (
            move(input_ids),
            torch.from_numpy(attn).to(device),
            move(mpos),
            torch.from_numpy(mmask).to(device),
            move(qt),
            move(tgt),
            move(soft),
            torch.from_numpy(has_soft).to(device),
        )

    head_params = (
        list(model.type_emb.parameters())
        + list(model.scorer.parameters())
        + list(model.corn.parameters())
    )
    enc_params = list(model.encoder.parameters())
    opt = torch.optim.AdamW(
        [{"params": enc_params, "lr": args.lr}, {"params": head_params, "lr": args.head_lr}],
        weight_decay=0.01,
    )

    idxs = list(range(len(encoded)))
    for epoch in range(args.epochs):
        random.shuffle(idxs)
        model.train()
        total, nb = 0.0, 0
        for start in range(0, len(idxs), args.batch):
            batch = [encoded[i] for i in idxs[start : start + args.batch]]
            input_ids, attn, mpos, mmask, qt, tgt, soft, has_soft = collate(batch)
            logits, corn_logits = model(input_ids, attn, mpos, mmask, qt)
            loss = _decision_loss(torch, F, logits, corn_logits, mmask, qt, tgt, soft, has_soft)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            total += float(loss.item())
            nb += 1
        print(f"[otsone] epoch {epoch + 1}/{args.epochs} loss={total / max(1, nb):.4f}")

    # ---- export ----------------------------------------------------------
    model.eval().to("cpu")
    ex = tuple(x.to("cpu") for x in collate([encoded[0], encoded[min(1, len(encoded) - 1)]]))
    dummy = ex[:5]
    out.mkdir(parents=True, exist_ok=True)
    onnx_path = out / "model.onnx"
    torch.onnx.export(
        model,
        dummy,
        str(onnx_path),
        input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
        output_names=["logits", "corn_logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "marker_pos": {0: "batch", 1: "count"},
            "marker_mask": {0: "batch", 1: "count"},
            "qtype": {0: "batch"},
            "logits": {0: "batch", 1: "count"},
            "corn_logits": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"[otsone] wrote {onnx_path} ({onnx_path.stat().st_size / 1e6:.1f} MB)")

    (out / "encoder").mkdir(exist_ok=True)
    enc_cfg = AutoConfig.from_pretrained(encoder_name).to_dict()
    enc_cfg["model_type"] = enc_cfg.get("model_type", "bert")
    (out / "encoder" / "config.json").write_text(json.dumps(enc_cfg, indent=2) + "\n")

    # Post-hoc per-type temperatures on a held-out 10% split (never one global T).
    rng = random.Random(args.seed)
    held = list(range(len(encoded)))
    rng.shuffle(held)
    cut = max(1, len(held) // 10)
    calib_set = [encoded[i] for i in held[:cut]] or encoded
    temperature = _calibrate_temperature(onnx_path, calib_set, collate, np)
    temps_by_name = {"choice": temperature[0], "score": temperature[1], "noul": temperature[2]}
    print(f"[otsone] calibrated per-type temperature {temps_by_name}")

    agent_cfg = {
        "format": "openjev-otsone",
        "format_version": 2,
        "architecture": "otsone-v2-corn",
        "model_name": MODEL_NAME,
        "family": MODEL_FAMILY,
        "backbone_tier": args.backbone,
        "encoder": encoder_name,
        "head_layers": 0,
        "corn_levels": CORN_LEVELS,
        "max_len": 512,
        "head_max_len": 192,
        "temperature": [round(t, 4) for t in temperature],
        "temperatures": {k: round(v, 4) for k, v in temps_by_name.items()},
        "temperature_by_options": {},
        "calibration": {
            "method": "calibration-native (label-smoothing + Dual-Focal + Brier) "
            "+ per-type temperature scaling",
            "label_smoothing": LS_EPS,
            "focal_gamma": FOCAL_GAMMA,
            "brier_weight": BRIER_WEIGHT,
            "held_out_frac": 0.1,
            "note": "per-type T fit by NLL (choice/noul softmax, score CORN). Ties to "
            "openjev isotonic/ECE: strictly-proper train loss + argmax-preserving "
            "post-hoc T; isotonic/Venn-Abers stay offline when |D_cal| is large.",
        },
    }
    (out / "rl_agent_config.json").write_text(json.dumps(agent_cfg, indent=2) + "\n")

    card = {
        "name": MODEL_NAME,
        "family": MODEL_FAMILY,
        "trained_by": TRAINED_BY,
        "architecture": "otsone-v2-corn",
        "backbone_tier": args.backbone,
        "backbone": encoder_name,
        "task": "typed-decision (choice/score/noul)",
        "runtime": "onnx (CPUExecutionProvider)",
        "score_head": "CORN rank-consistent ordinal (K-1 conditional sigmoids on [CLS])",
        "distinct_from": {
            "laya": "Convai ModernBERT-large decision model (run natively via laya_mlx.model)",
            "jev": "TypeSafe hosted cloud System One service",
        },
        "created": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "training": {
            "examples": len(encoded),
            "epochs": args.epochs,
            "batch": args.batch,
            "seed": args.seed,
            "gold_targets_folded": gold_added,
            "synthetic_rows": synthetic_added,
            "synthetic_axes": list(data_gen.AXES),
            "teacher_distillation": (not args.no_teacher),
            "teacher_live": data_gen.teacher_available(),
        },
        "corn_levels": CORN_LEVELS,
        "temperature": [round(t, 4) for t in temperature],
        "temperatures": {k: round(v, 4) for k, v in temps_by_name.items()},
        "metrics": {
            "gold_cases_passed": None,
            "gold_cases_total": None,
            "gold_checks_passed": None,
            "gold_checks_total": None,
            "accuracy": None,
            "ece": None,
            "evaluated_at": None,
        },
    }
    (out / "model_card.json").write_text(json.dumps(card, indent=2) + "\n")
    print(f"[otsone] wrote configs + model_card.json to {out}")
    print(f"[otsone] next: laya-mlx eval --model {out}")
    return 0


def _calibrate_temperature(onnx_path: Path, calib_set: list, collate, np) -> list:
    """Fit per-type temperatures on a held-out split (never one global T).

    CHOICE/NOUL: temperature minimising softmax NLL over the marker logits.
    SCORE: temperature minimising the conditional CORN NLL over the K-1
    thresholds. All three are argmax-/rank-preserving, so accuracy is untouched.
    """
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

    def run(items):
        input_ids, attn, mpos, mmask, qt = collate(items)[:5]
        feeds = {
            "input_ids": input_ids.cpu().numpy(),
            "attention_mask": attn.cpu().numpy(),
            "marker_pos": mpos.cpu().numpy(),
            "marker_mask": mmask.cpu().numpy(),
            "qtype": qt.cpu().numpy(),
        }
        outputs = sess.run(None, feeds)
        logits = outputs[0]
        corn = outputs[1] if len(outputs) > 1 else None
        return logits, corn

    softmax_rows = {0: [], 2: []}  # choice, noul -> (class_logits, target)
    corn_rows = []  # score -> (threshold_logits, level)
    for start in range(0, len(calib_set), 64):
        chunk = calib_set[start : start + 64]
        logits, corn = run(chunk)
        for row, it in enumerate(chunk):
            k, qt, target = len(it[1]), it[2], it[3]
            if qt == 1 and corn is not None:
                corn_rows.append(([float(v) for v in corn[row, : max(0, k - 1)]], int(target)))
            else:
                softmax_rows.setdefault(qt, []).append(
                    ([float(v) for v in logits[row, :k]], int(target))
                )

    t_choice = fit_temperature_nll(softmax_rows.get(0, [])) if softmax_rows.get(0) else 1.0
    t_noul = fit_temperature_nll(softmax_rows.get(2, [])) if softmax_rows.get(2) else 1.0
    t_score = fit_temperature_corn(corn_rows) if corn_rows else 1.0
    # order matches QTYPES: choice=0, score=1, noul=2
    return [t_choice, t_score, t_noul]


if __name__ == "__main__":
    raise SystemExit(main())
