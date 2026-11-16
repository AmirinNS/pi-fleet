#!/usr/bin/env python3
"""Experiment B: premature-edit trap. Runs both modes 3x, measures rework + quality."""
import json, subprocess, time, pathlib, shutil, re, sys

PROVIDER = sys.argv[1] if len(sys.argv) > 1 else "neuralwatt/kimi-k2.6"
TAG = sys.argv[2] if len(sys.argv) > 2 else PROVIDER.replace("/", "_")
FLEET = "/Users/amirinns/Projects/pi-fleet/src/index.ts"
TRAP = pathlib.Path("/tmp/eval/trap")
TARGET = TRAP / "eval_target.ts"
PRISTINE = pathlib.Path("/tmp/eval/trap/eval_target.pristine.ts")
RUNS = pathlib.Path("/tmp/eval/runs"); RUNS.mkdir(parents=True, exist_ok=True)
TIMEOUT = 300
TASK = ("The `shipping` function in eval_target.ts returns wrong values for standard shipping. "
        "Run `node --test --experimental-strip-types eval_target_test.ts` to see the failures, "
        "then fix the bug so ALL tests pass. Re-run the test to verify they pass.")
FLEET_TASK = "Use the `plan` tool to do the following: " + TASK

def run_pi(args, prompt, tag):
    cmd = ["pi", "--no-skills", "--no-context-files", "--model", PROVIDER, "--mode", "json", "-p", prompt]
    cmd[1:1] = args
    t0 = time.time()
    out = RUNS / f"trap.{tag}.jsonl"
    with open(out, "w") as f:
        try:
            subprocess.run(cmd, cwd=str(TRAP), stdout=f, stderr=subprocess.PIPE, timeout=TIMEOUT, text=True)
        except subprocess.TimeoutExpired:
            f.write('\n{"_timeout": true}\n')
    return time.time() - t0, out

def parse(path):
    edits = 0; first_edit_turn = None; turns = 0; ran_test = 0; bash_test_turns = []
    parent_cost = 0.0; parent_tokens = 0; pfin = 0; last_in = last_cr = 0
    child = None
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
            if names & {"edit", "write"}:
                edits += 1
                if first_edit_turn is None: first_edit_turn = turns
            for tr in o.get("toolResults", []):
                n = tr.get("toolName")
                d = tr.get("details") or {}
                if n == "bash":
                    # detect a test run by inspecting the tool call input (coarse: count bash turns)
                    ran_test += 1
                if n == "plan" and d.get("executorUsage"): child = d["executorUsage"]
                if n == "plan" and d.get("plannerUsage") and not child: child = d["plannerUsage"]
        if t == "message_end":
            m = o.get("message", {})
            if m.get("role") == "assistant":
                u = m.get("usage", {})
                parent_tokens += u.get("totalTokens", 0)
                parent_cost += (u.get("cost") or {}).get("total", 0)
                last_in = u.get("input", 0); last_cr = u.get("cacheRead", 0)
    return dict(turns=turns, edits=edits, first_edit_turn=first_edit_turn,
                bash_turns=ran_test, parent_tokens=parent_tokens, parent_cost=parent_cost,
                pfin=last_in+last_cr, child=child, timeout=False)

def quality():
    s = TARGET.read_text()
    # correct fix: standard branch uses weight - 3; express still weight - 5
    std_ok = bool(re.search(r"weight - 3", s)) and not bool(re.search(r"weight - 5\) \* 1", s))
    # run the test for real
    r = subprocess.run(["node","--test","--experimental-strip-types","eval_target_test.ts"],
                       cwd=str(TRAP), capture_output=True, text=True, timeout=60)
    tests_pass = "# pass 2" in r.stdout and "# fail 0" in r.stdout
    return ("pass" if (std_ok and tests_pass) else
            f"{'wrong-fix' if not std_ok else 'ok-fix'} tests={'pass' if tests_pass else 'FAIL'}")

def main():
    shutil.copy(TARGET, PRISTINE)  # save pristine buggy version
    results = []
    for mode, args, prompt in [("base", ["--no-extensions"], TASK), ("fleet", ["-e", FLEET], FLEET_TASK)]:
        for i in range(1, 4):
            tag = f"{mode}.{i}"
            shutil.copy(PRISTINE, TARGET)  # reset to buggy state
            wall, out = run_pi(args, prompt, tag)
            m = parse(out)
            if m.get("timeout"):
                results.append(dict(mode=mode, i=i, timeout=True)); continue
            m.update(mode=mode, i=i, wall_s=round(wall,1), quality=quality())
            # rework proxy: edit turns after the first edit
            m["rework"] = max(0, m["edits"] - 1)
            results.append(m)
    pathlib.Path(f"/tmp/eval/trap_results_{TAG}.json").write_text(json.dumps(results, indent=2))
    print(f"=== {PROVIDER} ({TAG}) ===")
    print(f"{'mode':>6} {'i':>2} {'quality':>24} {'wall':>6} {'turns':>6} {'edits':>6} {'rework':>7} {'bash':>5} {'pFin':>6}")
    for r in results:
        if r.get("timeout"): print(f"{r['mode']:>6} {r['i']:>2} TIMEOUT"); continue
        print(f"{r['mode']:>6} {r['i']:>2} {r['quality']:>24} {r['wall_s']:>6} {r['turns']:>6} {r['edits']:>6} {r['rework']:>7} {r['bash_turns']:>5} {r['pfin']:>6}")

if __name__ == "__main__":
    main()