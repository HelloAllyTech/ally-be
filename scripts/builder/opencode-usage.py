#!/usr/bin/env python3
"""Sum the tokens and cost of every opencode session on this runner.

Runners are disposable, so every session in opencode's local store belongs to
this job. Each session is exported (`opencode export <id>`) and its assistant
messages' `cost` and `tokens` are summed — the same fields `opencode stats`
reads; opencode prices them itself from its model catalogue.

Prints {"costUsd", "inputTokens", "outputTokens", "cacheReadTokens",
"cacheWriteTokens", "models"} to stdout. Never fails the job: no sessions, or
an unreadable export, is a zero.
"""
import json
import subprocess
import sys


def run(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return ""


def session_ids():
    raw = run("opencode", "session", "list", "--format", "json")
    try:
        data = json.loads(raw)
    except Exception:
        return []
    if isinstance(data, dict):
        data = data.get("sessions") or data.get("data") or []
    return [s.get("id") for s in data if isinstance(s, dict) and s.get("id")]


def main():
    total = {"costUsd": 0.0, "inputTokens": 0, "outputTokens": 0,
             "cacheReadTokens": 0, "cacheWriteTokens": 0, "models": {}}
    for sid in session_ids():
        raw = run("opencode", "export", sid)
        start = raw.find("{")
        if start < 0:
            continue
        try:
            data = json.loads(raw[start:])
        except Exception:
            continue
        for message in data.get("messages", []):
            info = message.get("info") or {}
            if info.get("role") != "assistant":
                continue
            tokens = info.get("tokens") or {}
            cache = tokens.get("cache") or {}
            cost = float(info.get("cost") or 0)
            total["costUsd"] += cost
            total["inputTokens"] += int(tokens.get("input") or 0)
            total["outputTokens"] += int(tokens.get("output") or 0) + int(tokens.get("reasoning") or 0)
            total["cacheReadTokens"] += int(cache.get("read") or 0)
            total["cacheWriteTokens"] += int(cache.get("write") or 0)
            model = info.get("modelID") or info.get("model") or "unknown"
            total["models"][model] = round(total["models"].get(model, 0) + cost, 6)
    total["costUsd"] = round(total["costUsd"], 6)
    json.dump(total, sys.stdout)


if __name__ == "__main__":
    main()
