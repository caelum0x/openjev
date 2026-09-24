"""Export a Laya DecisionModel checkpoint to ONNX.

This is a real export of the shipped model: a small PyTorch shim
(:func:`build_torch_model`) mirrors :mod:`laya_mlx.model` module-for-module,
the MLX ``model.safetensors`` weights are loaded into it by their existing
(already-sanitized) parameter names, and :func:`torch.onnx.export` writes
``model.onnx`` with dynamic ``(batch, seq)`` and ``(batch, count)`` axes.

The output directory has the exact shape the ONNX sidecar
(:class:`laya_mlx.server.OnnxEngine`) loads: ``model.onnx``, ``rl_agent_config.json``,
``encoder/config.json`` and ``tokenizer/``.

Torch and onnxruntime are imported lazily inside the functions, so importing this
module never requires the ``[onnx]`` extra and it stays importable on CI without
MLX. Attention is implemented with plain matmul + softmax (not fused SDPA) and
rotary embeddings are computed explicitly, so the graph exports cleanly and runs
on the CPU ExecutionProvider.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Optional

CANONICAL_INPUTS = ["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"]
CANONICAL_OUTPUTS = ["logits", "action"]


def normalize_encoder_config(cfg: dict) -> dict:
    """Reproduce the parts of EncoderConfig.from_dict the export needs, MLX-free."""
    hidden = int(cfg["hidden_size"])
    heads = int(cfg["num_attention_heads"])
    layers = int(cfg["num_hidden_layers"])
    head_dim = hidden // heads
    if cfg.get("model_type", "modernbert") != "modernbert":
        raise ValueError(f"Unsupported encoder: {cfg.get('model_type')!r}; expected modernbert")
    if cfg.get("hidden_activation", "gelu") != "gelu":
        raise ValueError("Unsupported encoder activation; expected gelu")
    if hidden % heads or head_dim % 2:
        raise ValueError("ModernBERT requires an even, integral attention head dimension")
    every = int(cfg.get("global_attn_every_n_layers", 3))
    layer_types = cfg.get("layer_types") or [
        "full_attention" if i % every == 0 else "sliding_attention" for i in range(layers)
    ]
    if len(layer_types) != layers or set(layer_types) - {"full_attention", "sliding_attention"}:
        raise ValueError("Invalid ModernBERT layer_types")
    rope_params = cfg.get("rope_parameters") or {}
    for kind in set(layer_types):
        if rope_params.get(kind, {}).get("rope_type", "default") != "default":
            raise ValueError("Only default (unscaled) ModernBERT RoPE is supported")

    def rope_base(kind: str) -> float:
        fallback = (
            float(cfg.get("global_rope_theta", 160000.0))
            if kind == "full_attention"
            else float(cfg.get("local_rope_theta", 10000.0))
        )
        return float(rope_params.get(kind, {}).get("rope_theta", fallback))

    return {
        "vocab_size": int(cfg["vocab_size"]),
        "hidden_size": hidden,
        "intermediate_size": int(cfg["intermediate_size"]),
        "num_hidden_layers": layers,
        "num_attention_heads": heads,
        "head_dim": head_dim,
        "norm_eps": float(cfg.get("norm_eps", 1e-5)),
        "norm_bias": bool(cfg.get("norm_bias", False)),
        "attention_bias": bool(cfg.get("attention_bias", False)),
        "mlp_bias": bool(cfg.get("mlp_bias", False)),
        "local_attention": int(cfg.get("local_attention", 128)),
        "layer_types": list(layer_types),
        "rope_base": {kind: rope_base(kind) for kind in ("full_attention", "sliding_attention")},
    }


def _load_safetensors_numpy(path: Path) -> dict:
    """Load an MLX-written safetensors file into a dict of numpy arrays, no MLX needed."""
    try:
        from safetensors.numpy import load_file

        return load_file(str(path))
    except Exception:
        import mlx.core as mx
        import numpy as np

        weights = mx.load(str(path))
        mx.eval(weights)
        return {k: np.array(v) for k, v in weights.items()}


def build_torch_model(encoder_cfg: dict, agent_cfg: dict):
    """Build a torch nn.Module that mirrors laya_mlx.model.DecisionModel exactly."""
    import torch
    from torch import nn

    ec = normalize_encoder_config(encoder_cfg)
    dims = ec["hidden_size"]

    def layernorm(size: int, bias: bool) -> nn.Module:
        return nn.LayerNorm(size, eps=ec["norm_eps"], bias=bias)

    def rope(x, base: float):
        # traditional=False rotary (HF/ModernBERT half-split), matching mx.fast.rope.
        d = x.shape[-1]
        seq = x.shape[-2]
        pos = torch.arange(seq, device=x.device, dtype=torch.float32)
        inv_freq = 1.0 / (base ** (torch.arange(0, d, 2, device=x.device).float() / d))
        freqs = torch.outer(pos, inv_freq)
        emb = torch.cat([freqs, freqs], dim=-1)
        cos = emb.cos()[None, None, :, :]
        sin = emb.sin()[None, None, :, :]
        x1, x2 = x[..., : d // 2], x[..., d // 2 :]
        rotated = torch.cat([-x2, x1], dim=-1)
        return x * cos + rotated * sin

    def attend(q, k, v, keep_mask):
        # keep_mask is a boolean tensor broadcastable to [b, heads, lq, lk]; True keeps.
        scale = q.shape[-1] ** -0.5
        scores = torch.matmul(q, k.transpose(-1, -2)) * scale
        scores = scores.masked_fill(~keep_mask, float("-inf"))
        weights = torch.softmax(scores, dim=-1)
        return torch.matmul(weights, v)

    class EncoderAttention(nn.Module):
        def __init__(self, kind: str):
            super().__init__()
            self.num_heads = ec["num_attention_heads"]
            self.head_dim = ec["head_dim"]
            self.base = ec["rope_base"][kind]
            self.Wqkv = nn.Linear(dims, 3 * dims, bias=ec["attention_bias"])
            self.Wo = nn.Linear(dims, dims, bias=ec["attention_bias"])

        def forward(self, x, mask):
            b, length, _ = x.shape
            qkv = self.Wqkv(x).reshape(b, length, 3, self.num_heads, self.head_dim)
            q, k, v = (qkv[:, :, i].permute(0, 2, 1, 3) for i in range(3))
            q = rope(q, self.base)
            k = rope(k, self.base)
            out = attend(q, k, v, mask)
            return self.Wo(out.permute(0, 2, 1, 3).reshape(b, length, -1))

    class EncoderMLP(nn.Module):
        def __init__(self):
            super().__init__()
            self.Wi = nn.Linear(dims, 2 * ec["intermediate_size"], bias=ec["mlp_bias"])
            self.Wo = nn.Linear(ec["intermediate_size"], dims, bias=ec["mlp_bias"])

        def forward(self, x):
            value, gate = self.Wi(x).chunk(2, dim=-1)
            return self.Wo(nn.functional.gelu(value) * gate)

    class EncoderLayer(nn.Module):
        def __init__(self, index: int):
            super().__init__()
            self.attention_type = ec["layer_types"][index]
            self.attn_norm = nn.Identity() if index == 0 else layernorm(dims, ec["norm_bias"])
            self.attn = EncoderAttention(self.attention_type)
            self.mlp_norm = layernorm(dims, ec["norm_bias"])
            self.mlp = EncoderMLP()

        def forward(self, x, mask):
            x = x + self.attn(self.attn_norm(x), mask)
            return x + self.mlp(self.mlp_norm(x))

    class Embeddings(nn.Module):
        def __init__(self):
            super().__init__()
            self.tok_embeddings = nn.Embedding(ec["vocab_size"], dims)
            self.norm = layernorm(dims, ec["norm_bias"])

        def forward(self, ids):
            return self.norm(self.tok_embeddings(ids))

    class ModernBert(nn.Module):
        def __init__(self):
            super().__init__()
            self.embeddings = Embeddings()
            self.layers = nn.ModuleList(
                EncoderLayer(i) for i in range(ec["num_hidden_layers"])
            )
            self.final_norm = layernorm(dims, ec["norm_bias"])
            self.window = ec["local_attention"]

        def masks(self, attention_mask):
            valid = attention_mask.bool()
            length = valid.shape[1]
            full = valid[:, None, None, :]
            positions = torch.arange(length, device=valid.device)
            local = (positions[:, None] - positions[None, :]).abs() <= self.window // 2
            local = (local[None, None] | ~valid[:, None, :, None]) & full
            return {"full_attention": full, "sliding_attention": local}

        def forward(self, input_ids, attention_mask):
            x = self.embeddings(input_ids)
            masks = self.masks(attention_mask)
            for layer in self.layers:
                x = layer(x, masks[layer.attention_type])
            return self.final_norm(x)

    class HeadAttention(nn.Module):
        def __init__(self):
            super().__init__()
            self.num_heads = max(1, dims // 64)
            if dims % self.num_heads:
                raise ValueError("Decision head dimensions must be divisible by its head count")
            self.head_dim = dims // self.num_heads
            self.in_proj = nn.Linear(dims, 3 * dims)
            self.out_proj = nn.Linear(dims, dims)

        def forward(self, x, mask):
            b, length, _ = x.shape
            qkv = self.in_proj(x).reshape(b, length, 3, self.num_heads, self.head_dim)
            q, k, v = (qkv[:, :, i].permute(0, 2, 1, 3) for i in range(3))
            out = attend(q, k, v, mask)
            return self.out_proj(out.permute(0, 2, 1, 3).reshape(b, length, -1))

    class HeadLayer(nn.Module):
        def __init__(self):
            super().__init__()
            self.self_attn = HeadAttention()
            self.norm1 = nn.LayerNorm(dims)
            self.norm2 = nn.LayerNorm(dims)
            self.linear1 = nn.Linear(dims, 4 * dims)
            self.linear2 = nn.Linear(4 * dims, dims)

        def forward(self, x, mask):
            x = x + self.self_attn(self.norm1(x), mask)
            # PyTorch TransformerEncoderLayer defaults to ReLU here (see model.py).
            return x + self.linear2(torch.relu(self.linear1(self.norm2(x))))

    class DecisionHead(nn.Module):
        def __init__(self, count: int):
            super().__init__()
            self.layers = nn.ModuleList(HeadLayer() for _ in range(count))

        def forward(self, x, mask):
            for layer in self.layers:
                x = layer(x, mask)
            return x

    class Indexed(nn.Module):
        """nn.Sequential exposed as `.layers` so weight names match the MLX checkpoint."""

        def __init__(self, *mods):
            super().__init__()
            self.layers = nn.ModuleList(mods)

        def forward(self, x):
            for layer in self.layers:
                x = layer(x)
            return x

    class DecisionModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = ModernBert()
            self.head = DecisionHead(int(agent_cfg.get("head_layers", 2)))
            self.type_emb = nn.Embedding(3, dims)
            self.scorer = Indexed(
                nn.LayerNorm(dims), nn.Linear(dims, dims), nn.GELU(), nn.Linear(dims, 1)
            )
            self.act_head = Indexed(
                nn.Linear(dims + 4, 256),
                nn.GELU(),
                nn.Linear(256, len(agent_cfg.get("act_costs", {})) + 1),
            )
            self.register_buffer("temperature", torch.ones(3))

        def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
            h = self.encoder(input_ids, attention_mask)
            h = h + self.type_emb(qtype).unsqueeze(1)
            h = self.head(h, attention_mask[:, None, None, :].bool())
            idx = marker_pos.clamp(min=0).unsqueeze(-1).expand(-1, -1, h.shape[-1])
            markers = torch.gather(h, 1, idx)
            logits = self.scorer(markers).squeeze(-1).float()
            logits = torch.where(marker_mask.bool(), logits, torch.full_like(logits, -1e4))
            p = torch.softmax(logits, dim=-1)
            k = marker_mask.sum(dim=-1).clamp(min=2).float()
            entropy = -(p * torch.log(p.clamp(min=1e-9))).sum(dim=-1) / torch.log(k)
            top = torch.sort(p, dim=-1).values[:, -2:]
            features = torch.stack(
                [top[:, 1], top[:, 1] - top[:, 0], entropy, k / 255.0], dim=-1
            )
            pooled = torch.cat([h[:, 0].float(), features], dim=-1)
            action = self.act_head(pooled).float()
            return logits, action

    return DecisionModel()


def _load_torch_weights(model, weights: dict) -> None:
    import torch

    tensors = {k: torch.from_numpy(v.copy()).float() for k, v in weights.items()}
    own = dict(model.state_dict())
    missing = set(own) - set(tensors)
    unexpected = set(tensors) - set(own)
    # `temperature` is a calibration buffer applied from the JSON config, not the graph.
    missing.discard("temperature")
    unexpected.discard("temperature")
    if missing:
        raise ValueError(f"Checkpoint is missing parameters for export: {sorted(missing)}")
    if unexpected:
        raise ValueError(f"Checkpoint has parameters with no home in the model: {sorted(unexpected)}")
    model.load_state_dict({k: v for k, v in tensors.items() if k in own}, strict=False)


def export_onnx(
    model_id_or_path,
    output,
    *,
    revision: Optional[str] = None,
    subfolder: Optional[str] = None,
    token: Optional[str] = None,
    opset: int = 17,
) -> Path:
    """Export an MLX Laya checkpoint to an ONNX sidecar directory.

    The destination must not exist. On any failure the partial directory is removed.
    """
    import torch

    from .agent import resolve_model

    output = Path(output).expanduser()
    if output.exists():
        raise FileExistsError(f"Output already exists: {output}")

    model_dir = resolve_model(
        model_id_or_path, token=token, subfolder=subfolder, revision=revision
    )
    encoder_cfg = json.loads((model_dir / "encoder/config.json").read_text())
    agent_cfg = json.loads((model_dir / "rl_agent_config.json").read_text())
    weights = _load_safetensors_numpy(model_dir / "model.safetensors")

    model = build_torch_model(encoder_cfg, agent_cfg)
    _load_torch_weights(model, weights)
    model.eval()

    output.mkdir(parents=True)
    try:
        shutil.copytree(model_dir / "tokenizer", output / "tokenizer")
        (output / "encoder").mkdir()
        (output / "encoder/config.json").write_text(json.dumps(encoder_cfg, indent=2) + "\n")
        (output / "rl_agent_config.json").write_text(json.dumps(agent_cfg, indent=2) + "\n")

        example = _example_inputs(model_dir, agent_cfg)
        with torch.no_grad():
            torch.onnx.export(
                model,
                example,
                str(output / "model.onnx"),
                input_names=CANONICAL_INPUTS,
                output_names=CANONICAL_OUTPUTS,
                dynamic_axes={
                    "input_ids": {0: "batch", 1: "seq"},
                    "attention_mask": {0: "batch", 1: "seq"},
                    "marker_pos": {0: "batch", 1: "count"},
                    "marker_mask": {0: "batch", 1: "count"},
                    "qtype": {0: "batch"},
                    "logits": {0: "batch", 1: "count"},
                    "action": {0: "batch"},
                },
                opset_version=opset,
                do_constant_folding=True,
            )
        metadata = {
            "format": "laya-onnx",
            "format_version": 1,
            "source": str(model_id_or_path),
            "revision": revision,
            "subfolder": subfolder,
            "opset": opset,
        }
        (output / "mlx_config.json").write_text(json.dumps(metadata, indent=2) + "\n")
    except BaseException:
        shutil.rmtree(output)
        raise
    return output


def _example_inputs(model_dir: Path, agent_cfg: dict):
    """Two tiny example rows built through this package's own tokenizer/prompt code."""
    import torch

    from .common import QTYPES, build_sequence
    from .server import to_internal
    from .tokenizer import Tokenizer

    tok = Tokenizer(model_dir / "tokenizer")
    max_len = int(agent_cfg.get("max_len", 512))
    head_max_len = int(agent_cfg.get("head_max_len", 192))
    samples = [
        ("An example customer message about a refund.",
         {"type": "choice", "instructions": "Which team?", "criteria": ["billing", "shipping"]}),
        ("Another short message.", {"type": "noul", "instructions": "Is this urgent?"}),
    ]
    rows = []
    for state, qdef in samples:
        q = to_internal(qdef)
        ids, markers = build_sequence(tok, state, q, max_len, head_max_len)
        rows.append((ids, markers, QTYPES[q["t"]]))
    length = max(len(ids) for ids, _, _ in rows)
    count = max(2, max(len(m) for _, m, _ in rows))
    n = len(rows)
    input_ids = torch.full((n, length), tok.pad_token_id, dtype=torch.int64)
    attention_mask = torch.zeros((n, length), dtype=torch.bool)
    marker_pos = torch.zeros((n, count), dtype=torch.int64)
    marker_mask = torch.zeros((n, count), dtype=torch.bool)
    qtype = torch.zeros((n,), dtype=torch.int64)
    for i, (ids, markers, qt) in enumerate(rows):
        input_ids[i, : len(ids)] = torch.tensor(ids, dtype=torch.int64)
        attention_mask[i, : len(ids)] = True
        marker_pos[i, : len(markers)] = torch.tensor(markers, dtype=torch.int64)
        marker_mask[i, : len(markers)] = True
        qtype[i] = qt
    return input_ids, attention_mask, marker_pos, marker_mask, qtype


def quantize_onnx(model_dir, output, *, per_channel: bool = False) -> Path:
    """Dynamically quantize an exported ONNX sidecar directory to int8 weights.

    Copies the sidecar files (configs, tokenizer) alongside the quantized graph so
    the result is a complete checkpoint the ONNX backend can load directly.
    """
    from onnxruntime.quantization import QuantType, quantize_dynamic

    model_dir = Path(model_dir).expanduser()
    output = Path(output).expanduser()
    if output.exists():
        raise FileExistsError(f"Output already exists: {output}")
    src_onnx = model_dir / "model.onnx"
    if not src_onnx.is_file():
        raise FileNotFoundError(f"No model.onnx to quantize in {model_dir}")

    output.mkdir(parents=True)
    try:
        for name in ("rl_agent_config.json", "mlx_config.json"):
            if (model_dir / name).is_file():
                shutil.copy2(model_dir / name, output / name)
        for name in ("encoder", "tokenizer"):
            if (model_dir / name).is_dir():
                shutil.copytree(model_dir / name, output / name)
        quantize_dynamic(
            str(src_onnx),
            str(output / "model.onnx"),
            weight_type=QuantType.QInt8,
            per_channel=per_channel,
        )
    except BaseException:
        shutil.rmtree(output)
        raise
    return output


__all__ = [
    "build_torch_model",
    "normalize_encoder_config",
    "export_onnx",
    "quantize_onnx",
    "CANONICAL_INPUTS",
    "CANONICAL_OUTPUTS",
]
