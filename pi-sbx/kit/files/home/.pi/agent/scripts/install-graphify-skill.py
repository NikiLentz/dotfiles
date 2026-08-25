#!/usr/bin/env python3

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

EXPECTED_VERSION = "0.9.50"


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected exactly one Graphify skill block, found {count}: {old[:80]!r}")
    return text.replace(old, new, 1)


def main() -> None:
    subprocess.run(
        [sys.executable, "-m", "graphify", "install", "--platform", "pi"],
        check=True,
    )

    agent_root = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent"))
    skill_path = agent_root / "skills" / "graphify" / "SKILL.md"
    version_path = skill_path.parent / ".graphify_version"
    installed_version = version_path.read_text(encoding="utf-8").strip()
    if installed_version != EXPECTED_VERSION:
        raise RuntimeError(
            f"Graphify skill version {installed_version!r} does not match pinned {EXPECTED_VERSION!r}"
        )

    text = skill_path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'description: "Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools."',
        'description: "Build, update, or query a project knowledge graph. Use when the user invokes /graphify, explicitly asks to map a large codebase, or graphify-out/ already exists and an architecture, dependency, call-flow, or impact question would benefit from graph traversal. Do not auto-build a graph without user intent."',
    )
    text = replace_once(
        text,
        "**MANDATORY: You MUST use the Agent tool here. Reading files yourself one-by-one is forbidden - it is 5-10x slower. If you do not use the Agent tool you are doing this wrong.**",
        "**MANDATORY: Use Pi's `subagent` tool in parallel mode here. Reading files yourself one-by-one is forbidden — it is 5-10x slower. Each semantic chunk needs the writing-capable `worker` agent so it can publish its JSON file.**",
    )

    start_marker = "**Step B2 - Dispatch ALL subagents in a single message**"
    end_marker = "**Step B3 - Collect, cache, and merge**"
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    replacement = """**Step B2 - Dispatch semantic workers with Pi's subagent tool**

Use one `subagent` tool call in parallel mode, with one task per chunk. Every task must use `agent: \"worker\"`, set `cwd` to the project root, include the exact extraction prompt from `references/extraction-spec.md`, and require the worker to write its result to the absolute CHUNK_PATH.

Pi accepts up to 12 tasks per parallel call and runs up to 8 concurrently. If there are more than 12 chunks, submit batches of at most 12 and wait for each batch before submitting the next. Do not use scout/planner/reviewer: they cannot write the required chunk file.

Example shape for three chunks:
```json
{
  "tasks": [
    { "agent": "worker", "task": "EXTRACTION_SPEC plus files 1-15; write CHUNK_PATH_01", "cwd": "PROJECT_ROOT" },
    { "agent": "worker", "task": "EXTRACTION_SPEC plus files 16-30; write CHUNK_PATH_02", "cwd": "PROJECT_ROOT" },
    { "agent": "worker", "task": "EXTRACTION_SPEC plus files 31-45; write CHUNK_PATH_03", "cwd": "PROJECT_ROOT" }
  ]
}
```

When possible, issue the Part A AST `bash` call and this parallel `subagent` call in the same assistant response; Pi executes sibling tool calls concurrently.

CHUNK_PATH must be absolute. Derive it from the current project root (the directory where Part C reads `graphify-out/`), not from the scanned corpus subdirectory:
```bash
PROJECT_ROOT=$(pwd)
# Chunk N: CHUNK_PATH="${PROJECT_ROOT}/graphify-out/.graphify_chunk_0N.json"
```

Each worker receives the exact prompt from `references/extraction-spec.md`, with FILE_LIST, CHUNK_NUM, TOTAL_CHUNKS, DEEP_MODE, and CHUNK_PATH substituted. The worker must write valid JSON to CHUNK_PATH; its chat response is only a completion signal.

"""
    text = text[:start] + replacement + text[end:]
    text = text.replace(
        "the subagent was likely dispatched as read-only (Explore type) — print a warning: \"chunk N missing from disk — subagent may have been read-only. Re-run with general-purpose agent.\"",
        "the worker did not publish its output — print a warning: \"chunk N missing from disk — re-run that chunk with the worker agent.\"",
    )
    text = text.replace(
        'ensure `subagent_type="general-purpose"` is used',
        'ensure the writing-capable `worker` agent is used',
    )
    text = text.replace(
        "**After each Agent call completes, read the real token counts from the Agent tool result's `usage` field and write them back into the chunk JSON before merging**",
        "**After each parallel subagent call completes, read each task's token counts from `details.results[].usage` and write them back into the matching chunk JSON before merging**",
    )
    skill_path.write_text(text, encoding="utf-8")
    print(f"  pi adaptation    ->  {skill_path}")


if __name__ == "__main__":
    main()
