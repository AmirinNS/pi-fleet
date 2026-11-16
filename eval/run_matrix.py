#!/usr/bin/env python3
"""
eval-benefits Milestone 3 runner: executes the task matrix both ways
(vanilla pi inline vs. pi-fleet via task/plan/remember+recall tools) across two
sandbox projects, captures per-run metrics from the pi JSON stream, and writes
eval/results.json + a summary table.

Provider pin: neuralwatt/kimi-k2.6 (real cloud, reports cacheRead/cacheWrite).
T3's 3x cache series is run separately by eval/t3_series.ts (direct coordinator).
"""
import json, os, subprocess, time, pathlib, shutil, re

PROVIDER = "neuralwatt/kimi-k2.6"
FLEET = "/Users/amirinns/Projects/pi-fleet/src/index.ts"
REAL_PI = "/Users/amirinns/Projects/pi-fleet"
REAL_P2 = "/Users/amirinns/Projects/bursa-futures"
EVAL = pathlib.Path("/tmp/eval")
RUNS = EVAL / "runs"; RUNS.mkdir(parents=True, exist_ok=True)
TIMEOUT = 240

# Pristine file sources for resets
PI_SUBAGENT = pathlib.Path(REAL_PI) / "src/subagent.ts"          # clean (no JSDoc)
P1_MARKERS_BUG = EVAL / "p1-markers.bug.txt"                     # planted bug
P2_ADDFUTURES_BUG = EVAL / "p2-addfutures.bug.txt"              # planted bug
P2_ADDFUTURES_CLEAN = pathlib.Path(REAL_P2) / "add_futures_data.py"

def run_pi(cwd, args, prompt, out_jsonl):
    cmd = ["pi", "--no-skills", "--no-context-files", "--model", PROVIDER,
           "--mode", "json", "-p", prompt]
    cmd[1:1] = args  # insert mode-specific flags
    t0 = time.time()
    with open(out_jsonl, "w") as f:
        try:
            subprocess.run(cmd, cwd=cwd, stdout=f, stderr=subprocess.PIPE,
                           timeout=TIMEOUT, text=True)
        except subprocess.TimeoutExpired:
            f.write('\n{"_timeout": true}\n')
    return time.time() - t0

def parse_stream(path):
    p = dict(input=0, output=0, cacheRead=0, cacheWrite=0, totalTokens=0, cost=0.0)
    parent_final_input = 0
    child = None
    planner_u = None; executor_u = None
    turns = 0
    edit_turns = 0
    first_edit_turn = None
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("_timeout"):
            return {"timeout": True}
        t = o.get("type")
        if t == "turn_end":
            turns += 1
            tools_this_turn = {tr.get("toolName") for tr in o.get("toolResults", [])}
            if tools_this_turn & {"edit", "write"}:
                edit_turns += 1
                if first_edit_turn is None:
                    first_edit_turn = turns
            for tr in o.get("toolResults", []):
                name = tr.get("toolName"); d = tr.get("details") or {}
                if name == "task" and d.get("usage"):
                    child = d["usage"]
                if name == "plan":
                    if d.get("plannerUsage"): planner_u = d["plannerUsage"]
                    if d.get("executorUsage"): executor_u = d["executorUsage"]
        if t == "message_end":
            m = o.get("message", {})
            if m.get("role") == "assistant":
                u = m.get("usage", {})
                p["input"] += u.get("input", 0)
                p["output"] += u.get("output", 0)
                p["cacheRead"] += u.get("cacheRead", 0)
                p["cacheWrite"] += u.get("cacheWrite", 0)
                p["totalTokens"] += u.get("totalTokens", 0)
                p["cost"] += (u.get("cost") or {}).get("total", 0)
                parent_final_input = u.get("input", 0)
    rework = max(0, edit_turns - 1) if edit_turns else 0
    return dict(parent=p, parent_final_input=parent_final_input, child=child,
                plannerUsage=planner_u, executorUsage=executor_u,
                turns=turns, edit_turns=edit_turns, rework=rework, timeout=False)

# ---------- task definitions ----------
def reset_p1(kind):
    p1 = pathlib.Path("/tmp/eval/p1")
    if kind == "t1":
        (p1 / "math.ts").unlink(missing_ok=True)
    elif kind == "t2":
        shutil.copy(PI_SUBAGENT, p1 / "src/subagent.ts")
    elif kind == "t3":
        shutil.copy(P1_MARKERS_BUG, p1 / "src/markers.ts")
    elif kind == "t4-clean":
        shutil.rmtree(p1 / ".pi", ignore_errors=True)
        (p1 / "deploy.txt").unlink(missing_ok=True)

def reset_p2(kind):
    p2 = pathlib.Path("/tmp/eval/p2")
    if kind == "t1":
        (p2 / "math.py").unlink(missing_ok=True)
    elif kind == "t2":
        shutil.copy(P2_ADDFUTURES_CLEAN, p2 / "add_futures_data.py")
    elif kind == "t3":
        shutil.copy(P2_ADDFUTURES_BUG, p2 / "add_futures_data.py")
    elif kind == "t4-clean":
        shutil.rmtree(p2 / ".pi", ignore_errors=True)
        (p2 / "delimiter.txt").unlink(missing_ok=True)

def quality_p1(kind):
    p1 = pathlib.Path("/tmp/eval/p1")
    if kind == "t1":
        f = p1 / "math.ts"
        if not f.exists(): return "FAIL: no math.ts"
        s = f.read_text()
        ok = "add" in s and "multiply" in s and "return" in s
        return "pass" if ok else "FAIL: missing functions"
    if kind == "t2":
        s = (p1 / "src/subagent.ts").read_text()
        # JSDoc line immediately above sumUsage
        m = re.search(r"(/\*\.*\*/|//[^\n]*)\nexport function sumUsage", s)
        has_jsdoc = bool(re.search(r"(?:/\*\*|//)[^\n]*\nexport function sumUsage", s))
        return "pass" if has_jsdoc else "FAIL: no JSDoc above sumUsage"
    if kind == "t3":
        s = (p1 / "src/markers.ts").read_text()
        ok = 'REQUIRES_APPROVAL = "[planner_requires_approval]";' in s
        return "pass" if ok else "FAIL: marker still broken"
    if kind == "t4":
        f = p1 / "deploy.txt"
        if not f.exists(): return "FAIL: no deploy.txt"
        s = f.read_text()
        return "pass" if "staging.mysite.com" in s else f"wrong/unknown: {s.strip()!r}"
    return "?"

def quality_p2(kind):
    p2 = pathlib.Path("/tmp/eval/p2")
    if kind == "t1":
        f = p2 / "math.py"
        if not f.exists(): return "FAIL: no math.py"
        s = f.read_text()
        ok = "def add" in s and "def multiply" in s and "return" in s
        return "pass" if ok else "FAIL: missing functions"
    if kind == "t2":
        s = (p2 / "add_futures_data.py").read_text()
        ok = bool(re.search(r'("""|\'\'\'|#)[^\n]*\n[^\n]*def validate_chart_data', s)) or \
             bool(re.search(r'def validate_chart_data[^\n]*:\n[ \t]+("""|\'\'\')', s))
        return "pass" if ok else "FAIL: no docstring on validate_chart_data"
    if kind == "t3":
        s = (p2 / "add_futures_data.py").read_text()
        ok = "len(data_entry) < 7" in s and "len(data_entry) < 6" not in s
        return "pass" if ok else "FAIL: threshold still wrong"
    if kind == "t4":
        f = p2 / "delimiter.txt"
        if not f.exists(): return "FAIL: no delimiter.txt"
        s = f.read_text()
        return "pass" if "semicolon" in s else f"wrong/unknown: {s.strip()!r}"
    return "?"

TASKS = {
    "t1": dict(text="Create a file named {f} with two {lang} functions: add(a, b) that returns a+b, and multiply(a, b) that returns a*b."),
    "t2": dict(text="Read the files {reads}, then add a single-line {doc} immediately above the `{sym}` function in {target} describing what it does."),
    "t3": dict(text="In {target} {bugdesc}"),
    "t4_remember": dict(text="Use the `remember` tool to store this fact: {fact}"),
    "t4_recall_fleet": dict(text="Use the `recall` tool to find {recallquery}, then write the answer to {outfile}. If recall returns nothing, write 'unknown'."),
    "t4_recall_base": dict(text="{recallquery_q}? Write the answer to {outfile}. If you don't know, write 'unknown'."),
}
FLEET_PREFIX = "Use the `{tool}` tool with profile `{prof}` to do the following, delegating ALL work via that tool (do not touch files yourself): "
PLAN_PREFIX = "Use the `plan` tool to do the following: "

PROJ = {
    "p1": dict(cwd="/tmp/eval/p1", lang="exported TypeScript", f="math.ts",
        reads="src/subagent.ts, src/coordinator.ts, and src/index.ts",
        doc="JSDoc comment", sym="sumUsage", target="src/markers.ts",
        bugdesc="there is a bug: the marker [planner_requires_approval] is never detected by parsePlan. Find and fix the bug.",
        fact="'The deployment target for this project is staging.mysite.com — never deploy to production.'",
        recallquery="the deployment target for this project",
        recallquery_q="What is the deployment target for this project", outfile="deploy.txt",
        reset=reset_p1, quality=quality_p1),
    "p2": dict(cwd="/tmp/eval/p2", lang="Python", f="math.py",
        reads="config.py, add_futures_data.py, and update_futures_daily_data.py",
        doc="docstring", sym="validate_chart_data", target="add_futures_data.py",
        bugdesc="the validate_chart_data function incorrectly rejects valid 7-field data rows. Find and fix the bug.",
        fact="'The futures data CSV uses semicolons as delimiters, not commas.'",
        recallquery="what delimiter the futures data CSV uses",
        recallquery_q="What delimiter does the futures data CSV use", outfile="delimiter.txt",
        reset=reset_p2, quality=quality_p2),
}

def fmt(task_id, proj, **extra):
    c = PROJ[proj]
    d = dict(**c, **extra)
    return TASKS[task_id]["text"].format(**d)

def do_run(cell_id, proj, mode_flags, prompt, kind_reset, kind_quality, expect_child_tool=None):
    c = PROJ[proj]
    if kind_reset:
        c["reset"](kind_reset)
    out = RUNS / f"{cell_id}.jsonl"
    wall = run_pi(c["cwd"], mode_flags, prompt, out)
    parsed = parse_stream(out)
    parsed["wall_s"] = round(wall, 1)
    parsed["cell"] = cell_id
    if kind_quality:
        parsed["quality"] = c["quality"](kind_quality)
    parsed["expect_child_tool"] = expect_child_tool
    parsed["child_tool_used"] = parsed.get("child") is not None or parsed.get("executorUsage") is not None or parsed.get("plannerUsage") is not None
    return parsed

def main():
    res = {}
    # ---------------- P1 ----------------
    # T1
    res["p1.t1.base"] = do_run("p1.t1.base", "p1", ["--no-extensions"], fmt("t1","p1"), "t1", "t1")
    res["p1.t1.fleet"] = do_run("p1.t1.fleet", "p1", ["-e", FLEET],
        FLEET_PREFIX.format(tool="task", prof="executor") + fmt("t1","p1"), "t1", "t1", "task")
    # T2
    res["p1.t2.base"] = do_run("p1.t2.base", "p1", ["--no-extensions"], fmt("t2","p1"), "t2", "t2")
    res["p1.t2.fleet"] = do_run("p1.t2.fleet", "p1", ["-e", FLEET],
        FLEET_PREFIX.format(tool="task", prof="executor") + fmt("t2","p1"), "t2", "t2", "task")
    # T3 (1x each; 3x series is separate)
    res["p1.t3.base"] = do_run("p1.t3.base", "p1", ["--no-extensions"], fmt("t3","p1"), "t3", "t3")
    res["p1.t3.fleet"] = do_run("p1.t3.fleet", "p1", ["-e", FLEET],
        PLAN_PREFIX + fmt("t3","p1"), "t3", "t3", "plan")
    # T4
    PROJ["p1"]["reset"]("t4-clean")
    res["p1.t4.remember"] = do_run("p1.t4.remember", "p1", ["-e", FLEET],
        fmt("t4_remember","p1"), None, None, "remember")
    res["p1.t4.recall_fleet"] = do_run("p1.t4.recall_fleet", "p1", ["-e", FLEET],
        fmt("t4_recall_fleet","p1"), None, "t4", "recall")
    PROJ["p1"]["reset"]("t4-clean")
    res["p1.t4.base"] = do_run("p1.t4.base", "p1", ["--no-extensions"],
        fmt("t4_recall_base","p1"), None, "t4")

    # ---------------- P2 ----------------
    res["p2.t1.base"] = do_run("p2.t1.base", "p2", ["--no-extensions"], fmt("t1","p2"), "t1", "t1")
    res["p2.t1.fleet"] = do_run("p2.t1.fleet", "p2", ["-e", FLEET],
        FLEET_PREFIX.format(tool="task", prof="executor") + fmt("t1","p2"), "t1", "t1", "task")
    res["p2.t2.base"] = do_run("p2.t2.base", "p2", ["--no-extensions"], fmt("t2","p2"), "t2", "t2")
    res["p2.t2.fleet"] = do_run("p2.t2.fleet", "p2", ["-e", FLEET],
        FLEET_PREFIX.format(tool="task", prof="executor") + fmt("t2","p2"), "t2", "t2", "task")
    res["p2.t3.base"] = do_run("p2.t3.base", "p2", ["--no-extensions"], fmt("t3","p2"), "t3", "t3")
    res["p2.t3.fleet"] = do_run("p2.t3.fleet", "p2", ["-e", FLEET],
        PLAN_PREFIX + fmt("t3","p2"), "t3", "t3", "plan")
    PROJ["p2"]["reset"]("t4-clean")
    res["p2.t4.remember"] = do_run("p2.t4.remember", "p2", ["-e", FLEET],
        fmt("t4_remember","p2"), None, None, "remember")
    res["p2.t4.recall_fleet"] = do_run("p2.t4.recall_fleet", "p2", ["-e", FLEET],
        fmt("t4_recall_fleet","p2"), None, "t4", "recall")
    PROJ["p2"]["reset"]("t4-clean")
    res["p2.t4.base"] = do_run("p2.t4.base", "p2", ["--no-extensions"],
        fmt("t4_recall_base","p2"), None, "t4")

    pathlib.Path("/tmp/eval/results.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()