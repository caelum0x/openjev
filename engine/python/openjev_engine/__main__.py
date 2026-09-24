import json
import sys

from .engine import run_local


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print("Usage: echo '{...request...}' | python -m openjev_engine", file=sys.stderr)
        sys.exit(2)
    req = json.loads(raw)
    out = run_local(req, req.get("model") or "system-one")
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
