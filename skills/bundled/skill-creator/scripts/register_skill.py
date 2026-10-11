#!/usr/bin/env python3
"""Register a validated skill package in a Metis workspace without flattening its files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from quick_validate import validate_skill

def register(root: Path, folder: Path):
    root = root.resolve()
    folder = folder.resolve()
    if not folder.is_relative_to(root) or folder == root:
        raise ValueError("The skill package must be inside the Metis workspace.")
    skill_id = folder.name
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,63}", skill_id):
        raise ValueError("Use a 2–64 character skill folder name.")
    valid, message = validate_skill(str(folder))
    if not valid:
        raise ValueError(message)
    entry = (folder / "SKILL.md").resolve()
    if not entry.is_relative_to(folder):
        raise ValueError("SKILL.md must stay inside the package.")
    lock_path = root / "skills-lock.json"
    lock = json.loads(lock_path.read_text()) if lock_path.exists() else {"version": 1, "skills": {}}
    lock.setdefault("skills", {})[skill_id] = {
        "source": "custom", "sourceType": "local",
        "skillPath": entry.relative_to(root).as_posix(),
        "computedHash": hashlib.sha256(entry.read_bytes()).hexdigest(),
    }
    with tempfile.NamedTemporaryFile(mode="w", dir=root, prefix=".skills-lock-", delete=False) as temp:
        json.dump(lock, temp, indent=2)
        temp.write("\n")
        temporary = Path(temp.name)
    os.chmod(temporary, lock_path.stat().st_mode if lock_path.exists() else 0o644)
    os.replace(temporary, lock_path)
    return skill_id

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_folder")
    parser.add_argument("--root", default=".", help="Metis workspace root")
    args = parser.parse_args()
    try:
        root = Path(args.root)
        folder = Path(args.skill_folder)
        if not folder.is_absolute():
            folder = root / folder
        print("Registered skill: " + register(root, folder))
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, str(error) + "\n")
