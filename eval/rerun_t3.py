#!/usr/bin/env python3
"""Re-run p2.t3 (base + fleet) with the corrected planted bug (< 8)."""
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path("/Users/amirinns/Projects/pi-fleet/eval")))
import run_matrix as R
R.TIMEOUT = 420
FLEET = R.FLEET

_q2_orig = R.quality_p2
def quality_p2(kind):
    if kind == "t3":
        s = pathlib.Path("/tmp/eval/p2/add_futures_data.py").read_text()
        ok = "len(data_entry) < 7" in s and "len(data_entry) < 8" not in s and "len(data_entry) < 6" not in s
        return "pass" if ok else "FAIL: threshold still wrong"
    return _q2_orig(kind)
R.PROJ["p2"]["quality"] = quality_p2

res = json.load(open("/tmp/eval/results.json"))
res["p2.t3.base"] = R.do_run("p2.t3.base", "p2", ["--no-extensions"], R.fmt("t3","p2"), "t3", "t3")
res["p2.t3.fleet"] = R.do_run("p2.t3.fleet", "p2", ["-e", FLEET],
    R.PLAN_PREFIX + R.fmt("t3","p2"), "t3", "t3", "plan")
pathlib.Path("/tmp/eval/results.json").write_text(json.dumps(res, indent=2))
for k in ["p2.t3.base","p2.t3.fleet"]:
    c = res[k]
    if c.get("timeout"):
        print(f"{k}: TIMEOUT"); continue
    p=c.get("parent",{}); ch=c.get("child") or c.get("executorUsage") or c.get("plannerUsage") or {}
    print(f"{k:16} q={c.get('quality','?'):30} wall={c.get('wall_s'):>6} pFin={c.get('parent_final_input',0):>5} pIn={p.get('input',0):>6} pCRead={p.get('cacheRead',0):>8} pTurns={c.get('turns',0):>3} child?={c.get('child_tool_used')} cIn={ch.get('input',0):>6} cCRead={ch.get('cacheRead',0):>8}")