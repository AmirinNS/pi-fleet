#!/usr/bin/env python3
"""
Multi-model extension: run T1 (trivial), T2 (explore-then-act), T4 (memory)
both ways on P1 for a given model. Tests whether the parent-cleanliness and
memory wins are model-robust. Usage: python3 eval/run_models.py <model-id> <tag>
"""
import json, subprocess, time, pathlib, shutil, re, sys

FLEET = "/Users/amirinns/Projects/pi-fleet/src/index.ts"
REAL_PI = "/Users/amirinns/Projects/pi-fleet"
EVAL = pathlib.Path("/tmp/eval")
RUNS = EVAL / "runs"; RUNS.mkdir(parents=True, exist_ok=True)
TIMEOUT = 300
MODEL = sys.argv[1]
TAG = sys.argv[2] if len(sys.argv) > 2 else MODEL.replace("/", "_")

PI_SUBAGENT = pathlib.Path(REAL_PI) / "src/subagent.ts"  # clean (no T2 marker)
P1 = pathlib.Path("/tmp/eval/p1")

def run_pi(args, prompt, tag):
    cmd = ["pi", "--no-skills", "--no-context-files", "--model", MODEL, "--mode", "json", "-p", prompt]
    cmd[1:1] = args
    t0 = time.time()
    out = RUNS / f"multi.{TAG}.{tag}.jsonl"
    with open(out, "w") as f:
        try:
            subprocess.run(cmd, cwd=str(P1), stdout=f, stderr=subprocess.PIPE, timeout=TIMEOUT, text=True)
        except subprocess.TimeoutExpired:
            f.write('\n{"_timeout": true}\n')
    return time.time() - t0, out

def parse(path):
    p = dict(input=0, output=0, cacheRead=0, cacheWrite=0, totalTokens=0, cost=0.0)
    last_in = 0; last_cr = 0; turns = 0; edit_turns = 0
    child = None; planner_u = None; executor_u = None
    for line in open(path):
        line = line.strip()
        if not line: continue
        try: o = json.loads(line)
        except: continue
        if o.get("_timeout"): return {"timeout": True}
        t = o.get("type")
        if t == "turn_end":
            turns += 1
            names = {tr.get("toolName") for tr in o.get("toolResults", [])}
            if names & {"edit", "write"}: edit_turns += 1
            for tr in o.get("toolResults", []):
                n = tr.get("toolName"); d = tr.get("details") or {}
                if n == "task" and d.get("usage"): child = d["usage"]
                if n == "plan":
                    if d.get("plannerUsage"): planner_u = d["plannerUsage"]
                    if d.get("executorUsage"): executor_u = d["executorUsage"]
        if t == "message_end":
            m = o.get("message", {})
            if m.get("role") == "assistant":
                u = m.get("usage", {})
                p["input"] += u.get("input", 0); p["output"] += u.get("output", 0)
                p["cacheRead"] += u.get("cacheRead", 0); p["cacheWrite"] += u.get("cacheWrite", 0)
                p["totalTokens"] += u.get("totalTokens", 0)
                p["cost"] += (u.get("cost") or {}).get("total", 0)
                last_in = u.get("input", 0); last_cr = u.get("cacheRead", 0)
    return dict(parent=p, pfin=last_in + last_cr, child=child,
                plannerUsage=planner_u, executorUsage=executor_u,
                turns=turns, edit_turns=edit_turns, rework=max(0, edit_turns - 1), timeout=False)

def child_usage(c):
    if c.get("child"): return c["child"]
    p = c.get("plannerUsage") or {}; e = c.get("executorUsage") or {}
    if not p and not e: return None
    def s(a, b, k): return (a.get(k, 0) if a else 0) + (b.get(k, 0) if b else 0)
    return {"input": s(p,e,"input"), "output": s(p,e,"output"), "cacheRead": s(p,e,"cacheRead"),
            "cacheWrite": s(p,e,"cacheWrite"), "totalTokens": s(p,e,"totalTokens"),
            "cost": {"total": (p.get("cost",{}).get("total",0) if p else 0)+(e.get("cost",{}).get("total",0) if e else 0)}}

T1 = "Create a file named math.ts with two exported TypeScript functions: add(a, b) that returns a+b, and multiply(a, b) that returns a*b."
T2 = "Read the files src/subagent.ts, src/coordinator.ts, and src/index.ts, then add a new line containing exactly `// T2-MARKER` on its own line immediately above the `sumUsage` function declaration in src/subagent.ts."
T4_REM = "Use the `remember` tool to store this fact: 'The deployment target for this project is staging.mysite.com — never deploy to production.'"
T4_REC = "Use the `recall` tool to find the deployment target for this project, then write the answer to a file named deploy.txt. If recall returns nothing, write 'unknown'."
T4_BASE = "What is the deployment target for this project? Write it to deploy.txt. If you don't know, write 'unknown'."
FLEET_TASK = "Use the `task` tool with profile `executor` to do the following, delegating ALL work via that tool (do not touch files yourself): "

def reset(kind):
    if kind == "t1": (P1 / "math.ts").unlink(missing_ok=True)
    elif kind == "t2": shutil.copy(PI_SUBAGENT, P1 / "src/subagent.ts")
    elif kind == "t4": shutil.rmtree(P1 / ".pi", ignore_errors=True); (P1 / "deploy.txt").unlink(missing_ok=True)

def quality(kind):
    if kind == "t1":
        f = P1 / "math.ts"
        if not f.exists(): return "FAIL: no math.ts"
        s = f.read_text()
        return "pass" if ("add" in s and "multiply" in s and "return" in s) else "FAIL: missing fns"
    if kind == "t2":
        s = (P1 / "src/subagent.ts").read_text()
        return "pass" if re.search(r"^[ \t]*// T2-MARKER\nexport function sumUsage", s, re.M) else "FAIL: no marker"
    if kind == "t4":
        f = P1 / "deploy.txt"
        if not f.exists(): return "FAIL: no deploy.txt"
        s = f.read_text()
        return "pass" if "staging.mysite.com" in s else f"wrong/unknown"

def do_cell(tag, args, prompt, reset_kind, qual_kind):
    if reset_kind: reset(reset_kind)
    wall, out = run_pi(args, prompt, tag)
    c = parse(out)
    c["wall_s"] = round(wall, 1); c["cell"] = tag
    if qual_kind: c["quality"] = quality(qual_kind)
    ch = child_usage(c) or {}
    c["total_tok"] = c["parent"]["totalTokens"] + ch.get("totalTokens", 0)
    c["total_cost"] = c["parent"]["cost"] + ch.get("cost", {}).get("total", 0)
    c["total_cacheRead"] = c["parent"]["cacheRead"] + ch.get("cacheRead", 0)
    c["child_used"] = c.get("child") is not None or c.get("executorUsage") or c.get("plannerUsage")
    return c

def main():
    r = {}
    r["t1.base"] = do_cell("t1.base", ["--no-extensions"], T1, "t1", "t1")
    r["t1.fleet"] = do_cell("t1.fleet", ["-e", FLEET], FLEET_TASK + T1, "t1", "t1")
    r["t2.base"] = do_cell("t2.base", ["--no-extensions"], T2, "t2", "t2")
    r["t2.fleet"] = do_cell("t2.fleet", ["-e", FLEET], FLEET_TASK + T2, "t2", "t2")
    reset("t4")
    r["t4.remember"] = do_cell("t4.remember", ["-e", FLEET], T4_REM, None, None)
    r["t4.recall"] = do_cell("t4.recall", ["-e", FLEET], T4_REC, None, "t4")
    reset("t4")
    r["t4.base"] = do_cell("t4.base", ["--no-extensions"], T4_BASE, None, "t4")
    pathlib.Path(f"/tmp/eval/multi_{TAG}.json").write_text(json.dumps(r, indent=2))
    print(f"=== {MODEL} ({TAG}) ===")
    for k in ["t1.base","t1.fleet","t2.base","t2.fleet","t4.remember","t4.recall","t4.base"]:
        c = r[k]
        if c.get("timeout"): print(f"  {k:12} TIMEOUT"); continue
        print(f"  {k:12} q={c.get('quality','?'):20} wall={c['wall_s']:>5} pFin={c['pfin']:>6} totalTok={c['total_tok']:>7} cacheRead={c['total_cacheRead']:>6} cost=${c['total_cost']:.4f} rework={c['rework']} child={c['child_used']}")

if __name__ == "__main__":
    main()