"""Portable OpenJev scorer — same algorithm as the TypeScript engine."""

from __future__ import annotations

import json
import math
import re
import time
from typing import Any

from .kernel import confidence, eval_cpp, softmax

SYNSETS = [
    ["urgent", "urgency", "immediately", "asap", "emergency", "now", "failing", "failed", "down", "outage", "wait", "waiting", "hours", "days", "critical", "help", "deadline", "overdue", "stuck", "blocked", "timesensitive"],
    ["refund", "refunds", "refunded", "charge", "charged", "charges", "payment", "payments", "invoice", "billing", "billed", "price", "cost", "subscription", "duplicate", "overcharged", "money", "payout", "payouts"],
    ["bug", "bugs", "error", "errors", "crash", "crashed", "exception", "integration", "api", "outage", "timeout", "broken", "fails", "failing", "failure", "technical"],
    ["spam", "scam", "phishing", "unsubscribe", "lottery", "prize", "winner", "congratulations", "crypto", "cheap", "offer"],
    ["sales", "pricing", "upgrade", "upgrades", "plan", "plans", "demo", "trial", "quote", "enterprise"],
    ["account", "login", "password", "access", "locked", "signup", "signin", "credentials"],
    ["shipping", "shipment", "delivery", "tracking", "delayed", "package", "lost", "transit"],
    ["return", "returns", "returned", "exchange", "exchanges"],
    ["angry", "furious", "frustrated", "frustration", "ridiculous", "unacceptable", "terrible", "worst", "hate", "third", "twice", "again", "still"],
    ["calm", "thanks", "thank", "okay", "ok", "received", "update", "appreciate", "neutral", "civil"],
    ["risky", "destructive", "irreversible", "delete", "drop", "production", "migrate", "schema", "danger"],
    ["human", "escalate", "manager", "legal", "compliance", "pii", "policy", "review"],
]

INDEX: dict[str, list[str]] = {}
for s in SYNSETS:
    for w in s:
        INDEX.setdefault(w, [])
        for x in s:
            if x not in INDEX[w]:
                INDEX[w].append(x)

STOP = set(
    "the a an of and or to in on for is are was were be been this that it as at by with from does do did how what which should would could i my we you your our me them they their its if not no yes can will just so but about into over after before than then too very also here there when where who whom has have had please".split()
)

_WORD = re.compile(r"[a-z0-9]+")


def stem(w: str) -> str:
    if len(w) <= 3:
        return w
    if w.endswith("ies") and len(w) > 5:
        return w[:-3] + "y"
    if w.endswith("ing") and len(w) > 5:
        return w[:-3]
    if w.endswith("ed") and len(w) > 4:
        return w[:-2]
    if w.endswith("ly") and len(w) > 4:
        return w[:-2]
    if w.endswith("es") and len(w) > 4:
        return w[:-2]
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        return w[:-1]
    return w


def tokenize(text: str) -> list[str]:
    raw = _WORD.findall(text.lower().replace("_", " ").replace("/", " "))
    out = []
    for r in raw:
        if len(r) < 2 or r in STOP:
            continue
        out.append(stem(r))
    return out


def expand(tokens: list[str]) -> list[str]:
    seen = []
    have = set()
    for t in tokens:
        if t not in have:
            have.add(t)
            seen.append(t)
        for s in INDEX.get(t, []):
            if s not in have:
                have.add(s)
                seen.append(s)
    return seen


def bag(tokens: list[str], expanded_w: float = 0.42) -> dict[str, float]:
    original = set(tokens)
    tf: dict[str, float] = {}
    for t in expand(tokens):
        tf[t] = tf.get(t, 0.0) + (1.0 if t in original else expanded_w)
    return {k: 1 + math.log(v) for k, v in tf.items()}


def ngrams(text: str, n: int = 3) -> dict[str, float]:
    s = " ".join(text.lower().split())
    tf: dict[str, float] = {}
    if len(s) < n:
        if s:
            tf[s] = 1.0
        return tf
    for i in range(0, len(s) - n + 1):
        g = s[i : i + n]
        if g.strip():
            tf[g] = tf.get(g, 0.0) + 1.0
    return {k: 1 + math.log(v) for k, v in tf.items()}


def idf(docs: list[dict[str, float]]) -> dict[str, float]:
    df: dict[str, int] = {}
    for d in docs:
        for k in d:
            df[k] = df.get(k, 0) + 1
    n = max(1, len(docs))
    return {k: math.log((n + 1) / (c + 0.5)) + 0.2 for k, c in df.items()}


def apply_idf(vec: dict[str, float], weights: dict[str, float]) -> dict[str, float]:
    return {k: v * weights.get(k, 1.0) for k, v in vec.items()}


def l2(vec: dict[str, float]) -> float:
    return math.sqrt(sum(v * v for v in vec.values()))


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    small, large = (a, b) if len(a) <= len(b) else (b, a)
    dot = sum(v * large.get(k, 0.0) for k, v in small.items())
    d = l2(a) * l2(b)
    return 0.0 if d == 0 else dot / d


def distinctive(option_tokens: list[list[str]]) -> list[set[str]]:
    df: dict[str, int] = {}
    for toks in option_tokens:
        for t in set(toks):
            df[t] = df.get(t, 0) + 1
    return [{t for t in toks if df.get(t, 0) <= 1} for toks in option_tokens]


def round4(x: float) -> float:
    return round(x, 4)


def state_to_text(state: Any) -> str:
    if isinstance(state, str):
        return state
    return json.dumps(state, ensure_ascii=False)


def _docs(options: list[tuple[str, str | None]]):
    out = []
    for key, desc in options:
        text = " \n ".join(p for p in [key.replace("_", " "), key, desc or ""] if p)
        toks = tokenize(text)
        out.append(
            {
                "key": key,
                "text": text,
                "tokens": toks,
                "bag": bag(toks),
                "ngrams": ngrams(text),
            }
        )
    return out


def _score_options(state_text: str, docs: list[dict]) -> list[float]:
    state_tokens = tokenize(state_text)
    state_bag = bag(state_tokens)
    state_ng = ngrams(state_text)
    weights = idf([state_bag, *[d["bag"] for d in docs]])
    state_w = apply_idf(state_bag, weights)
    dist = distinctive([d["tokens"] for d in docs])
    state_set = set(state_tokens)
    lower = state_text.lower()
    raw = []
    for i, d in enumerate(docs):
        dw = apply_idf(d["bag"], weights)
        lex = cosine(state_w, dw)
        fuzzy = cosine(state_ng, d["ngrams"])
        dset = dist[i]
        dist_hit = 0.0
        if dset:
            n = sum(1 for t in dset if t in state_set)
            dist_hit = n / math.sqrt(len(dset))
        key = d["key"].replace("_", " ")
        key_hit = 1.0 if key.lower() in lower else 0.0
        desc_hit = sum(0.2 for t in tokenize(d["text"]) if t in state_set and t in dset)
        syn_hit = sum(1 for t in state_tokens if t in expand(d["tokens"]))
        syn_score = syn_hit / math.sqrt(len(state_tokens)) if state_tokens else 0.0
        raw.append(
            1.2 * lex
            + 0.65 * fuzzy
            + 1.85 * dist_hit
            + 1.2 * key_hit
            + desc_hit
            + 1.4 * syn_score
        )
    return raw


def _temp(raw: list[float]) -> float:
    if len(raw) <= 1:
        return 0.4
    spread = max(raw) - min(raw)
    if spread < 0.12:
        return 0.7
    if spread < 0.35:
        return 0.48
    if spread < 0.8:
        return 0.36
    return 0.28


def _probs(raw: list[float]) -> list[float]:
    p = softmax(raw, _temp(raw))
    s = sum(p) or 1.0
    return [round4(x / s) for x in p]


def _renorm(prob: dict[str, float]) -> None:
    keys = list(prob)
    s = sum(prob[k] for k in keys)
    if s <= 0:
        u = round4(1 / max(1, len(keys)))
        for k in keys:
            prob[k] = u
        return
    for k in keys:
        prob[k] = round4(prob[k] / s)
    s2 = sum(prob[k] for k in keys)
    maxk = max(keys, key=lambda k: prob[k])
    prob[maxk] = round4(prob[maxk] + round4(1 - s2))


def eval_choice(state_text: str, q: dict) -> dict:
    keys = list(q["criteria"])
    docs = _docs([(k, q["criteria"][k]) for k in keys])
    p = _probs(_score_options(state_text, docs))
    probabilities = {k: p[i] for i, k in enumerate(keys)}
    _renorm(probabilities)
    best = max(keys, key=lambda k: probabilities[k])
    return {
        "type": "choice",
        "choice": best,
        "probabilities": probabilities,
        "confidence": round4(confidence(p)),
    }


def eval_score(state_text: str, q: dict) -> dict:
    levels = q["criteria"]
    docs = _docs([(f"level_{i}", c) for i, c in enumerate(levels)])
    p0 = _probs(_score_options(state_text, docs))
    if len(p0) > 2:
        out = []
        for i, x in enumerate(p0):
            l = p0[i - 1] if i else 0
            r = p0[i + 1] if i + 1 < len(p0) else 0
            out.append(0.78 * x + 0.11 * l + 0.11 * r)
        s = sum(out) or 1
        p = [x / s for x in out]
    else:
        p = p0
    legend = {str(i): c for i, c in enumerate(levels)}
    probabilities = {str(i): round4(p[i]) for i in range(len(levels))}
    _renorm(probabilities)
    expected = sum(i * p[i] for i in range(len(levels)))
    return {
        "type": "score",
        "score": round4(expected),
        "legend": legend,
        "probabilities": probabilities,
        "confidence": round4(confidence(p)),
    }


def eval_noul(state_text: str, q: dict) -> dict:
    crit = q.get("criteria") or {}
    yes = (crit.get("true") or "").strip() or f"The answer to this question is yes: {q['instructions']}"
    no = (crit.get("false") or "").strip() or f"The answer to this question is no: {q['instructions']}"
    docs = _docs([("yes", yes), ("no", no)])
    raw = _score_options(state_text, docs)
    p = softmax(raw, max(0.42, _temp(raw)))
    yes_p = p[0] if p else 0.5
    lower = state_text.lower()
    if re.search(r"\b(not|never|no|isn't|isnt|don't|dont|won't)\b", lower):
        inst = set(tokenize(q["instructions"]))
        st = set(tokenize(state_text))
        if inst & st:
            yes_p *= 0.85
    return {"type": "noul", "noul": round4(min(1.0, max(0.0, yes_p)))}


def eval_question(state_text: str, q: dict) -> dict:
    t = q["type"]
    if t == "choice":
        return eval_choice(state_text, q)
    if t == "score":
        return eval_score(state_text, q)
    return eval_noul(state_text, q)


def run_local(req: dict, model: str = "system-one") -> dict:
    payload = {**req, "model": req.get("model") or model}
    native = eval_cpp(payload)
    if native and isinstance(native, dict) and "answers" in native:
        return native
    t0 = time.perf_counter()
    state_text = state_to_text(req["state"])
    answers = {qid: eval_question(state_text, q) for qid, q in req["questions"].items()}
    ms = round((time.perf_counter() - t0) * 1000, 1)
    blob = json.dumps({"state": req["state"], "questions": req["questions"]})
    words = len(blob.split())
    return {
        "model": model,
        "answers": answers,
        "usage": {
            "input_tokens": max(1, round(words * 1.35 + len(blob) / 18)),
            "output_tokens": max(1, round(len(json.dumps(answers).split()) * 1.3)),
        },
        "latency_ms": ms,
    }
