"""Run exactly one authorized offline PoC task; never retry paid HTTP requests."""

import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.inference.ark_poc import ArkConfig, ArkPoc, PocError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--budget-cny", required=True)
    parser.add_argument("--approved-synthetic-only", action="store_true", required=True)
    parser.add_argument("--secrets-file", type=Path)
    args = parser.parse_args()
    if args.secrets_file:
        if args.secrets_file.stat().st_mode & 0o077:
            raise PocError("secrets_file_must_be_private")
        for line in args.secrets_file.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and key in {"ARK_API_KEY", "ARK_BASE_URL", "ARK_VISION_MODEL"}:
                os.environ[key] = value.strip()
    config = ArkConfig(os.environ.get("ARK_API_KEY", ""),
                       base_url=os.environ.get("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
                       model=os.environ.get("ARK_VISION_MODEL", "doubao-seed-2-1-pro-260915"))
    task = json.loads(args.task.read_text())
    result = ArkPoc(config, args.output_dir, args.budget_cny).run(task)
    row = result["invocation"]
    print(json.dumps({key: row[key] for key in ("invocation_id", "task_id", "http_status", "elapsed_ms", "estimated_cny", "validation")}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except PocError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
