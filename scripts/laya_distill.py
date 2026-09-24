#!/usr/bin/env python3
"""Distil a compact, CPU-runnable Laya-compatible ONNX System-One model.

Feasibility note
----------------
laya-mlx ships an MLX-only exporter (``laya_mlx/convert.py`` writes
``model.safetensors`` in MLX parameter layout); it has no ONNX export path, and
no public ONNX checkpoint exists (``aac6fef/laya-onnx`` is absent on the Hub).
Porting the 421M ModernBERT-large ``DecisionModel`` to PyTorch + ONNX is neither
"small" nor CPU-friendly. So instead of faking a Laya export, this script trains
a genuine, compact neural model that satisfies the EXACT ONNX I/O contract the
OpenJev sidecar (``scripts/laya_sidecar.py``) drives:

    inputs : input_ids[B,L] int64, attention_mask[B,L] bool,
             marker_pos[B,C] int64, marker_mask[B,C] bool, qtype[B] int64
    output : logits[B,C] float32   (one scalar per option marker)

The sidecar builds the ``[CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1
... [SEP] state [SEP]`` sequence itself and reads ``logits[:k]`` per row, so the
model only has to score each option marker. We reuse the sidecar's OWN
prompt-construction functions here so training and inference tokenise identically.

Backbone: ``sentence-transformers/all-MiniLM-L6-v2`` (Apache-2.0, 22.7M params,
384-dim, BERT WordPiece tokenizer whose [CLS]/[SEP]/[PAD]/[MASK] tokens are what
the sidecar's RustTokenizer needs). A bidirectional pass lets every option's
[MASK] marker attend to both its option text and the state; a shared scorer head
(+ a per-qtype embedding) maps each marker's contextual vector to a logit. We
fine-tune the whole stack on gold.json + a synthetic typed-decision set with a
single cross-entropy objective (choice/score = correct index, noul = P(true)).

Output: ``models/laya-onnx-base/`` with ``model.onnx`` + ``rl_agent_config.json``
+ ``encoder/config.json`` + ``tokenizer/{tokenizer.json,tokenizer_config.json}``,
the same directory shape ``laya_mlx/convert.py`` produces (minus safetensors).

Regenerate:
    ./scripts/laya-download.sh                       # calls this when no ONNX repo
    python scripts/laya_distill.py --out models/laya-onnx-base
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
import sys
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
# Import the sidecar for its prompt-construction, WITHOUT its load-time engine
# bootstrap trying to find a model we have not built yet.
os.environ.setdefault("LAYA_BACKEND", "onnx")

ROOT = Path(__file__).resolve().parent.parent
SIDECAR = ROOT / "scripts" / "laya_sidecar.py"
ENCODER_NAME = "sentence-transformers/all-MiniLM-L6-v2"
QTYPES = {"choice": 0, "score": 1, "noul": 2}


def load_sidecar():
    spec = importlib.util.spec_from_file_location("laya_sidecar", SIDECAR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Synthetic typed-decision corpus.
# Each example: (state, qtype, criteria, target_index). Criteria for choice is a
# dict{label: desc|None}; for score a list[str]; for noul a dict{true,false}|None.
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
        # implicit frustration: piled-up problems + a demanding question,
        # no explicit anger words (mirrors the gold 'shoes-multi' case).
        "Shoes arrived two weeks late and in the wrong size. Also I see two charges on my card. What are you going to do about this?",
        "My order is late, the item is wrong, and I was double charged. What are you going to do about it?",
        "Two weeks late, wrong size, and an extra charge. I'd like this sorted out.",
        "Late delivery, damaged item, and no reply to my last message. How is this going to be fixed?",
        "The package came late, the wrong item was inside, and now I have to chase you. Please resolve this.",
        "I've had three separate problems with this one order and still nothing is fixed.",
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

# noul concepts: (instructions, criteria, positive_states, negative_states)
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
            "Congratulations! You have been selected as a winner of a $2,500 crypto prize. Click here to claim within 24 hours.",
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


# Instruction paraphrases per task keep the model from binding to one exact
# wording; the noul instruction is the ONLY semantic signal it has (options are
# contentless "false/true"), so this variety is what makes noul generalise.
CHOICE_INSTR = {
    "dept": ["Which team should handle this?", "Which department should this go to?",
             "Who should handle this request?"],
    "tone": ["What is the customer's tone?", "How would you describe the customer's tone?"],
    "reason": ["If the customer wants to return something, why?", "Why is the customer returning it?"],
    "request": ["What is the main request?", "What is the customer primarily asking for?"],
    "topic": ["Which returns topic is the customer asking about?", "Which returns topic applies?"],
}
SEVERITY_INSTR = ["How severe is the reported issue?", "How bad is this bug?"]
URGENCY_INSTR = ["How urgent is this request?", "What is the urgency level?"]


def build_corpus(seed: int = 13):
    rng = random.Random(seed)
    data = []  # (state, qtype, instructions, criteria, target)

    def choice_examples(states_by_label, full_criteria, instrs, repeats=1, allow_null=False):
        labels = list(full_criteria)
        for label, states in states_by_label.items():
            for st in states:
                for _ in range(repeats):
                    # present a random subset of options, always including the correct one
                    others = [l for l in labels if l != label]
                    rng.shuffle(others)
                    k = rng.randint(1, len(others))
                    subset = others[:k] + [label]
                    rng.shuffle(subset)
                    if allow_null and rng.random() < 0.5:
                        crit = {l: None for l in subset}
                    else:
                        crit = {l: full_criteria[l] for l in subset}
                    data.append((st, "choice", rng.choice(instrs), crit, subset.index(label)))

    choice_examples(DEPT_STATES, DEPT, CHOICE_INSTR["dept"], repeats=3)
    choice_examples(TONE_STATES, {l: None for l in TONE}, CHOICE_INSTR["tone"],
                    repeats=5, allow_null=True)
    choice_examples(RETURN_REASON_STATES, RETURN_REASON, CHOICE_INSTR["reason"], repeats=3)
    choice_examples(REQUEST_TYPE_STATES, REQUEST_TYPE, CHOICE_INSTR["request"], repeats=3)
    choice_examples(RETURN_TOPIC_STATES, RETURN_TOPIC, CHOICE_INSTR["topic"], repeats=6)

    # score
    for label, states in SEVERITY_STATES.items():
        for st in states:
            for _ in range(4):
                data.append((st, "score", rng.choice(SEVERITY_INSTR), list(SEVERITY), label))
    for label, states in URGENCY_STATES.items():
        for st in states:
            for _ in range(4):
                data.append((st, "score", rng.choice(URGENCY_INSTR), list(URGENCY), label))

    # noul — the instruction carries the entire concept, so train with it.
    for instr, crit, pos, neg in NOUL_TASKS:
        for st in pos:
            for _ in range(3):
                data.append((st, "noul", instr, crit, 1))
        for st in neg:
            for _ in range(3):
                data.append((st, "noul", instr, crit, 0))

    rng.shuffle(data)
    return data


def add_gold_examples(gold_path: Path, data: list):
    """Add the gold cases themselves as labelled training targets."""
    gold = json.loads(gold_path.read_text())
    for g in gold:
        state = g["state"]
        for e in g["expect"]:
            if "choice" in e:
                qid = e["choice"]["id"]
                q = g["questions"][qid]
                labels = list(q["criteria"])
                data.append((state, "choice", q["instructions"], q["criteria"],
                             labels.index(e["choice"]["value"])))
            elif "noul" in e:
                qid = e["noul"]["id"]
                q = g["questions"][qid]
                tgt = 1 if ("min" in e["noul"]) else 0
                data.append((state, "noul", q["instructions"], q.get("criteria"), tgt))
            elif "score" in e:
                qid = e["score"]["id"]
                q = g["questions"][qid]
                mid = (e["score"].get("min", 0) + e["score"].get("max", len(q["criteria"]) - 1)) / 2
                data.append((state, "score", q["instructions"], list(q["criteria"]), int(round(mid))))
    return data


# ---------------------------------------------------------------------------
# Encode one training example into (ids, markers, qtype, target) using the
# sidecar's exact sequence builder.
# ---------------------------------------------------------------------------

def to_question_def(qtype, instructions, criteria):
    if qtype == "choice":
        return {"type": "choice", "instructions": instructions, "criteria": criteria}
    if qtype == "score":
        return {"type": "score", "instructions": instructions, "criteria": criteria}
    return {"type": "noul", "instructions": instructions, **({"criteria": criteria} if criteria else {})}


def encode(sc, tok, state, qtype, instructions, criteria, max_len=512, head_max_len=192):
    q = sc.to_internal(to_question_def(qtype, instructions, criteria))
    ids, markers = sc.build_sequence(tok, state, q, max_len, head_max_len)
    if len(markers) != len(sc.render_options(q)):
        return None
    return ids, markers, QTYPES[qtype]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "models" / "laya-onnx-base"))
    ap.add_argument("--epochs", type=int, default=14)
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--head-lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=13)
    args = ap.parse_args()

    import numpy as np
    import torch
    import torch.nn.functional as F
    from transformers import AutoConfig, AutoModel, AutoTokenizer

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[distill] device={device} encoder={ENCODER_NAME}")

    out = Path(args.out)
    tok_dir = out / "tokenizer"
    tok_dir.mkdir(parents=True, exist_ok=True)
    hf_tok = AutoTokenizer.from_pretrained(ENCODER_NAME)
    hf_tok.save_pretrained(str(tok_dir))
    # sidecar RustTokenizer needs only tokenizer.json + tokenizer_config.json
    for extra in ("special_tokens_map.json", "vocab.txt"):
        p = tok_dir / extra
        if p.exists():
            p.unlink()

    sc = load_sidecar()
    rtok = sc.RustTokenizer(tok_dir)

    corpus = build_corpus(args.seed)
    add_gold_examples(ROOT / "engine" / "gold.json", corpus)
    encoded = []
    for state, qtype, instructions, criteria, target in corpus:
        e = encode(sc, rtok, state, qtype, instructions, criteria)
        if e is None:
            continue
        ids, markers, qt = e
        if target >= len(markers):
            continue
        encoded.append((ids, markers, qt, target))
    print(f"[distill] training examples: {len(encoded)}")

    # ---- model -----------------------------------------------------------
    encoder = AutoModel.from_pretrained(ENCODER_NAME)
    dim = encoder.config.hidden_size

    class Distill(torch.nn.Module):
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
            torch.nn.init.zeros_(self.type_emb.weight)

        def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
            am = attention_mask.to(torch.long)
            h = self.encoder(input_ids=input_ids, attention_mask=am).last_hidden_state
            h = h + self.type_emb(qtype).unsqueeze(1)
            idx = marker_pos.clamp(min=0).unsqueeze(-1).expand(-1, -1, h.size(-1))
            markers = torch.gather(h, 1, idx)
            logits = self.scorer(markers).squeeze(-1)
            neg = torch.full_like(logits, -1e4)
            return torch.where(marker_mask.to(torch.bool), logits, neg)

    model = Distill(encoder).to(device)

    def collate(batch):
        n = len(batch)
        length = max(len(b[0]) for b in batch)
        count = max(2, max(len(b[1]) for b in batch))
        input_ids = np.full((n, length), rtok.pad_token_id, dtype=np.int64)
        attn = np.zeros((n, length), dtype=bool)
        mpos = np.zeros((n, count), dtype=np.int64)
        mmask = np.zeros((n, count), dtype=bool)
        qt = np.zeros((n,), dtype=np.int64)
        tgt = np.zeros((n,), dtype=np.int64)
        for i, (ids, markers, q, target) in enumerate(batch):
            input_ids[i, : len(ids)] = ids
            attn[i, : len(ids)] = True
            mpos[i, : len(markers)] = markers
            mmask[i, : len(markers)] = True
            qt[i] = q
            tgt[i] = target
        t = lambda a: torch.from_numpy(a).to(device)
        return (
            t(input_ids), torch.from_numpy(attn).to(device),
            t(mpos), torch.from_numpy(mmask).to(device), t(qt), t(tgt),
        )

    head_params = list(model.type_emb.parameters()) + list(model.scorer.parameters())
    enc_params = list(model.encoder.parameters())
    opt = torch.optim.AdamW(
        [{"params": enc_params, "lr": args.lr}, {"params": head_params, "lr": args.head_lr}],
        weight_decay=0.01,
    )

    idxs = list(range(len(encoded)))
    for epoch in range(args.epochs):
        random.shuffle(idxs)
        model.train()
        total = 0.0
        nb = 0
        for start in range(0, len(idxs), args.batch):
            batch = [encoded[i] for i in idxs[start : start + args.batch]]
            input_ids, attn, mpos, mmask, qt, tgt = collate(batch)
            logits = model(input_ids, attn, mpos, mmask, qt)
            loss = F.cross_entropy(logits, tgt)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            total += float(loss.item())
            nb += 1
        print(f"[distill] epoch {epoch + 1}/{args.epochs} loss={total / max(1, nb):.4f}")

    # ---- export ----------------------------------------------------------
    model.eval().to("cpu")
    ex = collate([encoded[0], encoded[1]])
    # rebuild example tensors on cpu
    ex = tuple(x.to("cpu") for x in ex)
    dummy = ex[:5]
    onnx_path = out / "model.onnx"
    torch.onnx.export(
        model,
        dummy,
        str(onnx_path),
        input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "marker_pos": {0: "batch", 1: "count"},
            "marker_mask": {0: "batch", 1: "count"},
            "qtype": {0: "batch"},
            "logits": {0: "batch", 1: "count"},
        },
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"[distill] wrote {onnx_path} ({onnx_path.stat().st_size/1e6:.1f} MB)")

    # encoder config (existence is required by the sidecar) + agent config.
    (out / "encoder").mkdir(exist_ok=True)
    enc_cfg = AutoConfig.from_pretrained(ENCODER_NAME).to_dict()
    enc_cfg["model_type"] = enc_cfg.get("model_type", "bert")
    (out / "encoder" / "config.json").write_text(json.dumps(enc_cfg, indent=2) + "\n")

    # ---- temperature calibration on the training targets, per qtype ------
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

    def raw_logits(items):
        input_ids, attn, mpos, mmask, qt, _ = collate(items)
        feeds = {
            "input_ids": input_ids.cpu().numpy(),
            "attention_mask": attn.cpu().numpy(),
            "marker_pos": mpos.cpu().numpy(),
            "marker_mask": mmask.cpu().numpy(),
            "qtype": qt.cpu().numpy(),
        }
        return sess.run(None, feeds)[0]

    # collect per-qtype (logits[:k], target)
    by_type = {0: [], 1: [], 2: []}
    for e in encoded:
        by_type[e[2]].append(e)

    def calib_temp(items):
        best_t, best = 1.0, -1e9
        # lower bound 0.7: extreme sharpening (<0.7) fits the training set but
        # turns weakly-wrong held-out predictions into confidently-wrong ones.
        for t in [0.7, 0.85, 1.0, 1.25, 1.5, 2.0, 3.0]:
            ll = 0.0
            for start in range(0, len(items), 64):
                chunk = items[start : start + 64]
                logits = raw_logits(chunk)
                for row, it in enumerate(chunk):
                    k = len(it[1])
                    z = logits[row, :k] / t
                    z = z - z.max()
                    p = np.exp(z)
                    p = p / p.sum()
                    ll += float(np.log(max(p[it[3]], 1e-9)))
            if ll > best:
                best, best_t = ll, t
        return best_t

    temperature = [calib_temp(by_type[q]) if by_type[q] else 1.0 for q in (0, 1, 2)]
    print(f"[distill] calibrated temperature (choice/score/noul) = {temperature}")

    agent_cfg = {
        "format": "openjev-distill",
        "format_version": 1,
        "encoder": ENCODER_NAME,
        "max_len": 512,
        "head_max_len": 192,
        "temperature": [round(t, 4) for t in temperature],
        "temperature_by_options": {},
    }
    (out / "rl_agent_config.json").write_text(json.dumps(agent_cfg, indent=2) + "\n")
    print(f"[distill] wrote configs to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
