"""Prepare the verified four-scan/two-up M0 sample, without any network calls.

Only explicitly supplied paper/key paths are read. Never glob a directory of
answer sheets. This is a sample-specific preparation tool, not general OCR.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]


def dump(path, value):
    if path.exists():
        raise SystemExit(f"refusing to overwrite existing PoC input: {path}")
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def prepare_extract(args, templates):
    if not args.paper or len(args.answer_keys or []) != 4 or not args.two_up:
        raise SystemExit("extract requires --paper, four --answer-keys and --two-up")
    out = args.output_dir
    if (out / "paper-task.json").exists() or (out / "key-task.json").exists():
        raise SystemExit("use a new output directory; executed tasks must stay immutable")
    pages = out / "pages"
    inputs = out / "inputs"
    pages.mkdir(parents=True, exist_ok=True)
    inputs.mkdir(exist_ok=True)
    result = subprocess.run(["pdftoppm", "-r", "110", "-png", str(args.paper), str(pages / "paper")],
                            capture_output=True, text=True)
    if result.returncode:
        raise SystemExit("PDF rendering failed; no network request was made")
    scanned = sorted(pages.glob("paper-*.png"))
    if len(scanned) != 4:
        raise SystemExit("this verified sample requires exactly four two-up scans")
    for kind, sources in [("paper", scanned), ("key", args.answer_keys)]:
        images = []
        for n, source in enumerate(sources):
            with Image.open(source) as im:
                for side in range(2):
                    crop = im.crop((side * im.width // 2, 0, (side + 1) * im.width // 2, im.height)).convert("RGB")
                    target = inputs / f"{kind}-{2 * n + side + 1}.jpg"
                    crop.save(target, quality=95)
                    images.append(str(target))
        task = templates[kind]
        task["images"] = images
        dump(out / ("paper-task.json" if kind == "paper" else "key-task.json"), task)
    manifest = [{"name": p.name, "bytes": p.stat().st_size,
                 "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in [args.paper, *args.answer_keys]]
    dump(out / "approved-input-manifest.json", manifest)
    print("Prepared paper/key tasks. Review images locally before any paid call.")


def prepare_synthetic(args, templates):
    if not args.model_dir:
        raise SystemExit("synthetic requires --model-dir with observed extraction results")
    out = args.output_dir
    if (out / "synthetic-task.json").exists():
        raise SystemExit("refusing to overwrite an existing synthetic task")
    ledger = json.loads((args.model_dir / "ledger.json").read_text())
    extracted = []
    for task_id in ["extract-paper-v1", "extract-answer-key-v1"]:
        rows = [r for r in ledger["invocations"] if r["task_id"] == task_id]
        if len(rows) != 1 or rows[0].get("validation") != "schema_passed_pending_human_review":
            raise SystemExit("extraction not observed and schema-validated; no paid call allowed")
        path = args.model_dir / (rows[0]["invocation_id"] + ".parsed.json")
        extracted.append(json.loads(path.read_text()))
    cases = json.loads((ROOT / "tests/poc/synthetic_cases.json").read_text())
    image = Image.new("RGB", (1200, 820), "white")
    draw = ImageDraw.Draw(image)
    monaco = Path("/System/Library/Fonts/Monaco.ttf")
    font = ImageFont.truetype(str(monaco), 24) if monaco.exists() else ImageFont.load_default(size=24)
    draw.text((30, 25), "SYNTHETIC PoC - NO STUDENT DATA", font=font, fill="black")
    for i, case in enumerate(cases):
        draw.text((30, 110 + i * 78), f"{case['case_id']} | Q{case['question_id']} | {case['answer']}", font=font, fill="black")
    inputs = out / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    path = inputs / "synthetic-cases.png"
    image.save(path)
    task = templates["synthetic"]
    task["images"] = [str(path)]
    task["prompt"] += "\n试卷提取数据:\n" + json.dumps(extracted[0], ensure_ascii=False)
    task["prompt"] += "\n标准答案提取数据:\n" + json.dumps(extracted[1], ensure_ascii=False)
    dump(out / "synthetic-task.json", task)
    dump(out / "synthetic-cases.json", cases)
    print("Prepared eight synthetic cases. No real student material was read.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["extract", "synthetic"])
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--paper", type=Path)
    parser.add_argument("--answer-keys", nargs="+", type=Path)
    parser.add_argument("--two-up", action="store_true")
    parser.add_argument("--model-dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    templates = json.loads((ROOT / "config/ark-poc-task-templates.json").read_text())
    if args.phase == "extract":
        prepare_extract(args, templates)
    else:
        prepare_synthetic(args, templates)
