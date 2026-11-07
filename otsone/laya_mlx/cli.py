"""Command-line prediction, checkpoint conversion, ONNX export, and training."""

import argparse
import importlib
import json
import sys
from pathlib import Path
from typing import Optional

from . import __version__
from .agent import DTYPES, Agent

# (module_name, extra_name) for each subcommand that just delegates its whole
# tail of argv to a sibling stage module's own argparse parser.
_DELEGATED_COMMANDS = {
    "distill": ("distill", "train"),
    "eval": ("eval_gold", "onnx"),
    # eval-external has no extra install group: it is stdlib-only (urllib +
    # the already-present eval_gold/calibration math), so it works in any
    # otsone install without the onnx/train extras.
    "eval-external": ("eval_external", None),
}


def _delegate(module_name: str, extra: Optional[str], argv):
    """Hand off to a sibling stage module (distill / eval / eval-external), with a clean error."""
    try:
        module = importlib.import_module(f"laya_mlx.{module_name}")
    except ImportError as exc:
        hint = (
            f"Install the training/onnx extras (pip install 'otsone[{extra}]') and "
            if extra
            else ""
        )
        raise SystemExit(
            f"'{module_name}' is unavailable: {exc}. {hint}Ensure the {module_name} module is present."
        )
    entry = getattr(module, "main", None)
    if entry is None:
        raise SystemExit(f"laya_mlx.{module_name} has no main() entry point")
    return entry(argv)


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    # `distill`/`eval` take their own flags (e.g. `--backbone`, `--model`) that
    # otsone's top-level parser knows nothing about. Routing them through an
    # `argparse` subparser with `nargs=argparse.REMAINDER` hits a known argparse
    # limitation: any leading `--flag` in the remainder gets flagged as
    # "unrecognized arguments" by the *top-level* parser before the subparser's
    # REMAINDER can claim it (confirmed by actually running `otsone distill
    # --backbone otsone-mini` 2026-11-06 -- it failed every time). So these two
    # commands are dispatched directly here, before any argparse parsing of the
    # tail, and the delegated module's own parser (which already handles
    # `--help` correctly) owns everything after the command name.
    if argv and argv[0] in _DELEGATED_COMMANDS:
        module_name, extra = _DELEGATED_COMMANDS[argv[0]]
        return _delegate(module_name, extra, argv[1:])

    parser = argparse.ArgumentParser(prog="otsone", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)

    for command in ("predict", "convert"):
        sub = commands.add_parser(command)
        sub.add_argument("--model", default="convaiinnovations/laya")
        sub.add_argument("--subfolder")
        sub.add_argument("--revision")
        sub.add_argument("--dtype", choices=DTYPES, default="float16")
        if command == "predict":
            source = sub.add_mutually_exclusive_group(required=True)
            source.add_argument("--state", help="Plain text input")
            source.add_argument("--state-file", type=Path, help="JSON state file")
            sub.add_argument("--questions", required=True, type=Path, help="JSON question definitions")
            sub.add_argument("--device", choices=("gpu", "cpu"), default="gpu")
            sub.add_argument("--batch-size", type=int, default=16)
        else:
            sub.add_argument("--output", type=Path, required=True)

    export = commands.add_parser("export-onnx", help="Export the DecisionModel to ONNX")
    export.add_argument("--model", default="convaiinnovations/laya")
    export.add_argument("--subfolder")
    export.add_argument("--revision")
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--opset", type=int, default=17)

    quantize = commands.add_parser("quantize", help="Dynamically quantize an ONNX checkpoint")
    quantize.add_argument("--model", type=Path, required=True, help="Exported ONNX directory")
    quantize.add_argument("--output", type=Path, required=True)
    quantize.add_argument("--per-channel", action="store_true")

    commands.add_parser(
        "distill", help="Train a compact ONNX model (delegates to laya_mlx.distill)"
    ).add_argument("args", nargs=argparse.REMAINDER)
    commands.add_parser(
        "eval", help="Evaluate an ONNX checkpoint (delegates to laya_mlx.eval_gold)"
    ).add_argument("args", nargs=argparse.REMAINDER)
    commands.add_parser(
        "eval-external",
        help="Run the gold calibration report against a third party's own model/API "
        "(delegates to laya_mlx.eval_external)",
    ).add_argument("args", nargs=argparse.REMAINDER)

    args = parser.parse_args(argv)

    if args.command == "convert":
        from .convert import convert

        result = convert(
            args.model, args.output, dtype=args.dtype, revision=args.revision,
            subfolder=args.subfolder,
        )
        print(json.dumps({"output": str(result), "dtype": args.dtype}))
    elif args.command == "predict":
        state = args.state if args.state is not None else json.loads(args.state_file.read_text())
        questions = json.loads(args.questions.read_text())
        agent = Agent(
            args.model, device=args.device, dtype=args.dtype, revision=args.revision,
            subfolder=args.subfolder, batch_size=args.batch_size,
        )
        print(json.dumps(agent.predict(state, questions), ensure_ascii=False, indent=2))
    elif args.command == "export-onnx":
        from .onnx_export import export_onnx

        result = export_onnx(
            args.model, args.output, revision=args.revision, subfolder=args.subfolder,
            opset=args.opset,
        )
        print(json.dumps({"output": str(result), "format": "laya-onnx"}))
    elif args.command == "quantize":
        from .onnx_export import quantize_onnx

        result = quantize_onnx(args.model, args.output, per_channel=args.per_channel)
        print(json.dumps({"output": str(result), "quantization": "dynamic-int8"}))
    elif args.command == "distill":
        return _delegate("distill", "train", args.args)
    elif args.command == "eval":
        return _delegate("eval_gold", "onnx", args.args)
    elif args.command == "eval-external":
        return _delegate("eval_external", None, args.args)


if __name__ == "__main__":
    raise SystemExit(main())
