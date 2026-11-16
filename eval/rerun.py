#!/usr/bin/env python3
"""Targeted re-runs: fixed T2 (marker comment) + p2.t3.fleet (longer timeout)."""
import json, subprocess, time, pathlib, shutil, re, sys
sys.path.insert(0, str(pathlib.Path("/Users/amirinns/Projects/pi-fleet/eval")))
import run_matrix as R
R.TIMEOUT = 420
FLEET = R.FLEET

# Fix T2 task: unambiguous marker line above the function.
MARKER_P1 = "// T2-MARKER"
MARKER_P2 = "# T2-MARKER"
R.TASKS["t2"] = dict(text="Read the files {reads}, then add a new line containing exactly `{marker}` on its own line immediately above the `{sym}` function declaration in {target}.")
R.PROJ["p1"]["marker"] = MARKER_P1
R.PROJ["p2"]["marker"] = MARKER_P2

_q1_orig = R.quality_p1
_q2_orig = R.quality_p2
def quality_p1(kind):
    if kind == "t2":
        s = pathlib.Path("/tmp/eval/p1/src/subagent.ts").read_text()
        return "pass" if re.search(r"^[ \t]*// T2-MARKER\nexport function sumUsage", s, re.M) else "FAIL: no T2-MARKER above sumUsage"
    return _q1_orig(kind)
def quality_p2(kind):
    if kind == "t2":
        s = pathlib.Path("/tmp/eval/p2/add_futures_data.py").read_text()
        return "pass" if re.search(r"^[ \t]*# T2-MARKER\ndef validate_chart_data", s, re.M) else "FAIL: no T2-MARKER above validate_chart_data"
    return _q2_orig(kind)
R.PROJ["p1"]["quality"] = quality_p1
R.PROJ["p2"]["quality"] = quality_p2

res = json.load(open("/tmp/eval/results.json"))

# Re-run T2 (both projects, both modes)
for proj in ("p1","p2"):
    res[f"{proj}.t2.base"] = R.do_run(f"{proj}.t2.base", proj, ["--no-extensions"], R.fmt("t2",proj), "t2", "t2")
    res[f"{proj}.t2.fleet"] = R.do_run(f"{proj}.t2.fleet", proj, ["-e", FLEET],
        R.FLEET_PREFIX.format(tool="task", prof="executor") + R.fmt("t2",proj), "t2", "t2", "task")

# Re-run p2.t3.fleet with longer timeout
res["p2.t3.fleet"] = R.do_run("p2.t3.fleet", "p2", ["-e", FLEET],
    R.PLAN_PREFIX + R.fmt("t3","p2"), "t3", "t3", "plan")

pathlib.Path("/tmp/eval/results.json").write_text(json.dumps(res, indent=2))
for k in ["p1.t2.base","p1.t2.fleet","p2.t2.base","p2.t2.fleet","p2.t3.fleet"]:
    c = res[k]
    if c.get("timeout"):
        print(f"{k}: TIMEOUT"); continue
    p=c.get("parent",{}); ch=c.get("child") or c.get("executorUsage") or c.get("plannerUsage") or {}
    print(f"{k:16} q={c.get('quality','?'):30} wall={c.get('wall_s'):>6} pFin={c.get('parent_final_input',0):>5} pIn={p.get('input',0):>6} pCRead={p.get('cacheRead',0):>7} pTurns={c.get('turns',0):>2} child?={c.get('child_tool_used')} cIn={ch.get('input',0):>6} cCRead={ch.get('cacheRead',0):>7}")