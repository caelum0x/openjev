"""Teacher-distillation data recipe for otsone-1 (the 8 gold axes).

``docs/RESEARCH-OTSONE.md`` section 4 specifies a synthetic corpus spread across
eight generation axes that stress different failure modes of a typed-decision
model. This module produces that corpus **deterministically** (seeded, no
network) so it can extend :func:`laya_mlx.distill.build_corpus` on CI, and
exposes an **optional LLM-teacher hook** that, when an API key is present in the
environment, replaces the deterministic hard label with a soft label
distribution (the teacher's "dark knowledge") for knowledge distillation.

Design constraints (match the rest of the package):

* Standard library only at import time. ``numpy``/``requests`` are imported
  lazily, and never on the deterministic path, so this stays CI-safe and MLX-free.
* Rows are the exact ``(state, qtype, instructions, criteria, target)`` shape the
  trainer already consumes, so wiring is a list ``extend`` -- no new schema.
* Soft labels ride alongside as an optional parallel dict keyed by row index, so
  the hard-label path is unchanged when no teacher is configured.

Axes (task-specified): paraphrase, negation, domain-shift, ambiguous, minimal,
longform, structured, multilingual.
"""

from __future__ import annotations

import math
import os
import random
from typing import Callable, Dict, List, Optional, Sequence, Tuple

Row = Tuple[object, str, object, object, int]

AXES: Tuple[str, ...] = (
    "paraphrase",
    "negation",
    "domain-shift",
    "ambiguous",
    "minimal",
    "longform",
    "structured",
    "multilingual",
)

# Environment gate for the optional teacher. When unset, generation is fully
# deterministic and offline; when set, soft labels are requested from the teacher.
TEACHER_KEY_ENV = "OTSONE_TEACHER_API_KEY"
TEACHER_MODEL_ENV = "OTSONE_TEACHER_MODEL"

# --- small, self-contained banks per axis ---------------------------------

_DEPT = {
    "returns": "Exchanges, refunds, wrong or damaged items",
    "shipping": "Delivery status, delays, lost packages",
    "billing": "Charges, invoices, payment problems",
    "technical": "Bugs, errors, outages, things not working",
}
_DEPT_CORE = {
    "returns": "I want to send this jacket back for a refund.",
    "shipping": "Where is my parcel, it is three days late?",
    "billing": "I was charged twice for the same order.",
    "technical": "The checkout page throws a 500 error every time.",
}

_SEVERITY = [
    "Cosmetic; no impact to functionality",
    "Broken or degraded feature, but a workaround exists",
    "Blocking issue; no workaround exists",
]

# Synonym table used by the paraphrase axis (deterministic, order-stable).
_SYNONYMS = {
    "refund": "money back",
    "parcel": "package",
    "late": "delayed",
    "charged": "billed",
    "error": "failure",
    "want": "would like",
    "send": "ship",
    "broken": "not working",
}

# Multilingual renderings of a single refund-request state (target: true).
_MULTILINGUAL_REFUND = {
    "tr": "Siparisim iptal edildi, param iade edilsin istiyorum.",
    "es": "Mi pedido fue cancelado, quiero un reembolso.",
    "de": "Meine Bestellung wurde storniert, ich moechte eine Rueckerstattung.",
    "zh": "我的订单被取消了，我想要退款。",
}
_MULTILINGUAL_NEG = {
    "tr": "Sadece magazanin pazar gunu kacta acildigini soralim.",
    "es": "Solo queria saber a que hora abre la tienda el domingo.",
    "de": "Ich wollte nur wissen, wann der Laden am Sonntag oeffnet.",
    "zh": "我只想知道商店周日几点开门。",
}

_REFUND_INSTR = "Does this message request a refund?"
_DEPT_INSTR = "Which department should handle this request?"
_SEVERITY_INSTR = "How severe is the reported issue?"


def _paraphrase(text: str, rng: random.Random) -> str:
    words = text.split()
    out = []
    for w in words:
        key = w.strip(".,!?").lower()
        if key in _SYNONYMS and rng.random() < 0.7:
            out.append(_SYNONYMS[key])
        else:
            out.append(w)
    return " ".join(out)


def _choice_crit(labels: Sequence[str]) -> Dict[str, str]:
    return {label: _DEPT[label] for label in labels if label in _DEPT}


def _axis_rows(axis: str, rng: random.Random, per_axis: int) -> List[Row]:
    """Deterministically synthesise ``per_axis`` rows for one axis."""
    rows: List[Row] = []
    dept_labels = list(_DEPT_CORE)

    def add_dept_choice(state: str, label: str) -> None:
        others = [d for d in dept_labels if d != label]
        rng.shuffle(others)
        k = rng.randint(1, len(others))
        subset = others[:k] + [label]
        rng.shuffle(subset)
        rows.append((state, "choice", _DEPT_INSTR, _choice_crit(subset), subset.index(label)))

    for _ in range(per_axis):
        label = rng.choice(dept_labels)
        base = _DEPT_CORE[label]

        if axis == "paraphrase":
            add_dept_choice(_paraphrase(base, rng), label)
        elif axis == "negation":
            # A refund noul whose polarity is flipped by an explicit negation.
            if rng.random() < 0.5:
                rows.append(("I do not want a refund, just fixing my address.", "noul", _REFUND_INSTR, None, 0))
            else:
                rows.append(("There is no way I am keeping this, refund me now.", "noul", _REFUND_INSTR, None, 1))
        elif axis == "domain-shift":
            # Same primitives, out-of-distribution (clinic/travel) surface text.
            state = rng.choice(
                [
                    "The clinic billed my insurance twice for one visit.",
                    "My connecting flight was cancelled and never rebooked.",
                    "The vending machine took my money and gave nothing.",
                ]
            )
            add_dept_choice(state, "billing")
        elif axis == "ambiguous":
            # Borderline severity -- kept regardless; middle level is the label.
            rows.append(
                (
                    "It sometimes works and sometimes does not, hard to say.",
                    "score",
                    _SEVERITY_INSTR,
                    list(_SEVERITY),
                    1,
                )
            )
        elif axis == "minimal":
            # Low signal: severity must not hallucinate -- stays at the low level.
            rows.append((rng.choice(["ok", "hello", "thanks", "?"]), "score", _SEVERITY_INSTR, list(_SEVERITY), 0))
        elif axis == "longform":
            state = " ".join(rng.sample(list(_DEPT_CORE.values()), k=3)) + " " + base
            add_dept_choice(state, label)
        elif axis == "structured":
            state = {"channel": "email", "priority": "high", "body": base, "label_hint": label}
            add_dept_choice_structured(rows, state, label, rng, dept_labels)
        elif axis == "multilingual":
            lang = rng.choice(list(_MULTILINGUAL_REFUND))
            if rng.random() < 0.5:
                rows.append((_MULTILINGUAL_REFUND[lang], "noul", _REFUND_INSTR, None, 1))
            else:
                rows.append((_MULTILINGUAL_NEG[lang], "noul", _REFUND_INSTR, None, 0))
    return rows


def add_dept_choice_structured(rows, state, label, rng, dept_labels) -> None:
    """A department choice over a structured (dict) state."""
    others = [d for d in dept_labels if d != label]
    rng.shuffle(others)
    k = rng.randint(1, len(others))
    subset = others[:k] + [label]
    rng.shuffle(subset)
    rows.append((state, "choice", _DEPT_INSTR, _choice_crit(subset), subset.index(label)))


def build_synthetic_corpus(
    seed: int = 13,
    axes: Optional[Sequence[str]] = None,
    per_axis: int = 12,
) -> List[Row]:
    """Deterministic 8-axis synthetic corpus in trainer-row shape.

    Seeded so ``build_synthetic_corpus(s) == build_synthetic_corpus(s)``; the
    per-axis RNG is derived from ``seed`` and the axis name so axis order is
    irrelevant to any single axis's output.
    """
    axes = list(AXES if axes is None else axes)
    rows: List[Row] = []
    for axis in axes:
        rng = random.Random(hash((seed, axis)) & 0xFFFFFFFF)
        rows.extend(_axis_rows(axis, rng, per_axis))
    return rows


# ---------------------------------------------------------------------------
# Optional LLM-teacher hook (env-gated soft labels / dark knowledge).
# ---------------------------------------------------------------------------


def teacher_available(env: Optional[dict] = None) -> bool:
    """True when a teacher API key is configured (otherwise fully offline)."""
    env = os.environ if env is None else env
    return bool((env.get(TEACHER_KEY_ENV) or "").strip())


def _deterministic_soft_label(target: int, num_options: int, sharpness: float = 3.0) -> List[float]:
    """A calibrated-looking soft distribution peaked at ``target``.

    The deterministic fallback for the teacher: not one-hot (that would give the
    student no dark knowledge), but a smooth distribution whose mass concentrates
    on the correct option and decays with distance -- ordinal-aware, so it also
    serves the SCORE axis sensibly.
    """
    if num_options <= 1:
        return [1.0]
    weights = [math.exp(-sharpness * abs(i - target) / max(1, num_options - 1)) for i in range(num_options)]
    total = math.fsum(weights)
    return [w / total for w in weights]


def soft_labels_for(
    rows: Sequence[Row],
    option_counts: Sequence[int],
    teacher: Optional[Callable[[Row, int], Optional[List[float]]]] = None,
    env: Optional[dict] = None,
) -> Dict[int, List[float]]:
    """Soft-label distributions per row index for knowledge distillation.

    When a ``teacher`` callable is supplied (or an API key is configured and the
    default HTTP teacher is used) its distribution is used; otherwise the
    deterministic ordinal-aware fallback is returned. Rows the teacher declines
    (returns ``None``) fall back to the deterministic distribution, so the map is
    always complete and training never stalls on a teacher gap.
    """
    if teacher is None and teacher_available(env):
        teacher = _http_teacher(env)
    labels: Dict[int, List[float]] = {}
    for idx, (row, num_options) in enumerate(zip(rows, option_counts)):
        target = int(row[4])
        dist: Optional[List[float]] = None
        if teacher is not None:
            try:
                dist = teacher(row, num_options)
            except Exception:  # noqa: BLE001 -- a teacher gap must not fail training
                dist = None
        if dist is None or len(dist) != num_options:
            dist = _deterministic_soft_label(target, num_options)
        labels[idx] = dist
    return labels


def _http_teacher(env: Optional[dict]) -> Callable[[Row, int], Optional[List[float]]]:
    """Build an HTTP teacher closure (used only when an API key is present).

    Kept lazy and defensive: any import/transport error yields ``None`` for that
    row so :func:`soft_labels_for` falls back deterministically. The endpoint is
    an OpenAI-compatible chat completion returning the JSON schema from the spec.
    """
    env = os.environ if env is None else env
    api_key = (env.get(TEACHER_KEY_ENV) or "").strip()
    model = (env.get(TEACHER_MODEL_ENV) or "gpt-5-nano").strip()
    base_url = (env.get("OTSONE_TEACHER_BASE_URL") or "https://api.openai.com/v1").rstrip("/")

    import json

    def teacher(row: Row, num_options: int) -> Optional[List[float]]:
        if not api_key:
            return None
        import urllib.request

        state, qtype, instructions, _criteria, _target = row
        prompt = (
            "You are a typed-decision oracle. Return ONLY a JSON object "
            '{"distribution":[p0,...]} of length %d that sums to 1, calibrated: '
            "spread mass when the input is ambiguous.\nTYPE: %s\nQUESTION: %s\nSTATE: %s"
            % (num_options, qtype, instructions, json.dumps(state, ensure_ascii=False))
        )
        body = json.dumps(
            {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "response_format": {"type": "json_object"},
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            base_url + "/chat/completions",
            data=body,
            headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 -- fixed https host
            payload = json.loads(resp.read())
        content = payload["choices"][0]["message"]["content"]
        dist = json.loads(content).get("distribution")
        if not isinstance(dist, list) or len(dist) != num_options:
            return None
        total = math.fsum(float(x) for x in dist)
        if total <= 0:
            return None
        return [float(x) / total for x in dist]

    return teacher
