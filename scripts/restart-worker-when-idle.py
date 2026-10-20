#!/usr/bin/env python3
"""Activate a prepared worker only after all persisted and live jobs have drained."""
import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time


def unit_state(service):
    result = subprocess.run(
        ["systemctl", "show", service, "-p", "MainPID", "-p", "ActiveState", "-p", "ControlGroup"],
        check=True, capture_output=True, text=True, timeout=10,
    )
    return dict(line.split("=", 1) for line in result.stdout.splitlines())


def observe(database, service):
    unit = unit_state(service)
    if unit["ActiveState"] != "active":
        raise RuntimeError("Worker service is not active; refusing automatic repair")
    with sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True, timeout=2) as db:
        active = db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('running','queued','switching','waiting_input','waiting_for_user')").fetchone()[0]
    group = Path("/sys/fs/cgroup") / unit["ControlGroup"].lstrip("/")
    children = []
    for pid in (group / "cgroup.procs").read_text().split():
        try:
            if b"worker-job.ts" in Path("/proc", pid, "cmdline").read_bytes():
                children.append(int(pid))
        except FileNotFoundError:
            pass  # This process exited while the group was being inspected.
    return {"pid": int(unit["MainPID"]), "active_jobs": active, "job_processes": children}


def wait_and_restart(inspect, restart, expected_pid, timeout, now=time.monotonic, pause=time.sleep):
    deadline, idle_since = now() + timeout, None
    while now() < deadline:
        state = inspect()
        if state["pid"] != expected_pid:
            return {"status": "superseded", "observed": state}
        if state["active_jobs"] == 0 and not state["job_processes"]:
            if idle_since is None:
                idle_since = now()
            elif now() - idle_since >= 2:
                restart()
                return {"status": "restarted", "old_pid": expected_pid}
        else:
            idle_since = None
        pause(.5)
    return {"status": "deferred_timeout", "old_pid": expected_pid}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--expected-pid", type=int, required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]*\.service", args.service) or not 0 < args.timeout <= 86400:
        parser.error("A named service and bounded positive timeout are required")
    if args.dry_run:
        print(json.dumps({"status": "dry_run", "observed": observe(args.db, args.service)}))
        return 0

    def restart():
        subprocess.run(["systemctl", "restart", args.service], check=True, timeout=45)

    try:
        result = wait_and_restart(lambda: observe(args.db, args.service), restart, args.expected_pid, args.timeout)
        if result["status"] == "restarted":
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                unit = unit_state(args.service)
                heartbeat = Path(args.db).parent / "worker-heartbeat.json"
                health = json.loads(heartbeat.read_text()) if heartbeat.exists() else {}
                group = Path("/sys/fs/cgroup") / unit["ControlGroup"].lstrip("/")
                pids = (group / "cgroup.procs").read_text().split()
                if (unit["ActiveState"] == "active" and int(unit["MainPID"]) != args.expected_pid
                        and health.get("status") == "running" and str(health.get("pid")) in pids):
                    result.update(status="verified", new_pid=int(unit["MainPID"]), heartbeat=health)
                    break
                time.sleep(.5)
            if result["status"] != "verified":
                raise RuntimeError("Worker restarted but new heartbeat could not be verified")
    except Exception as error:
        result = {"status": "failed", "error": str(error)}
    destination = Path(args.result)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(destination)
    print(json.dumps(result))
    return 0 if result["status"] in ("verified", "superseded") else 1


if __name__ == "__main__":
    raise SystemExit(main())
