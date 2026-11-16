#!/usr/bin/env python3
"""Compile eval results into the docs/research.md tables."""
import json, pathlib

res = json.load(open("/tmp/eval/results.json"))
series = json.load(open("/tmp/eval/t3_series.json"))

# Re-parse each run's JSONL to get the parent's FINAL context size correctly.
# kimi reports per-turn `input` as the UNCACHED portion only; real context =
# input + cacheRead for the last assistant turn.
def parent_final_context(cell_name):
    path = pathlib.Path(f"/tmp/eval/runs/{cell_name}.jsonl")
    if not path.exists(): return None
    last = None
    for l in path.read_text().splitlines():
        l=l.strip()
        if not l: continue
        try: o=json.loads(l)
        except: continue
        if o.get("type")=="message_end" and o.get("message",{}).get("role")=="assistant":
            u=o["message"].get("usage",{})
            last = (u.get("input",0), u.get("cacheRead",0))
    return (last[0]+last[1]) if last else 0

PFC = {}
for k in res:
    PFC[k] = parent_final_context(k) or 0

def child_usage(c):
    """Return a summed child Usage dict for a cell (task tool -> child;
    plan tool -> plannerUsage+executorUsage)."""
    if c.get("child"):
        return c["child"]
    p = c.get("plannerUsage") or {}
    e = c.get("executorUsage") or {}
    if not p and not e:
        return None
    def s(a,b,k): return (a.get(k,0) if a else 0) + (b.get(k,0) if b else 0)
    return {
        "input": s(p,e,"input"), "output": s(p,e,"output"),
        "cacheRead": s(p,e,"cacheRead"), "cacheWrite": s(p,e,"cacheWrite"),
        "totalTokens": s(p,e,"totalTokens"),
        "cost": {"total": (p.get("cost",{}).get("total",0) if p else 0)+(e.get("cost",{}).get("total",0) if e else 0)},
    }

def metrics(k):
    c = res[k]
    if c.get("timeout"): return None
    p = c.get("parent",{})
    ch = child_usage(c) or {}
    parent_fin = PFC.get(k, c.get("parent_final_input",0))
    total_tok = p.get("totalTokens",0) + ch.get("totalTokens",0)
    cache_read = p.get("cacheRead",0) + ch.get("cacheRead",0)
    cache_write = p.get("cacheWrite",0) + ch.get("cacheWrite",0)
    cost = p.get("cost",0) + ch.get("cost",{}).get("total",0)
    return dict(q=c.get("quality","?"), wall=c.get("wall_s",0), pfin=parent_fin,
        total_tok=total_tok, cache_read=cache_read, cache_write=cache_write,
        cost=cost, rework=c.get("rework",0), turns=c.get("turns",0),
        p_in=p.get("input",0), p_out=p.get("output",0), p_cread=p.get("cacheRead",0),
        c_in=ch.get("input",0), c_out=ch.get("output",0), c_cread=ch.get("cacheRead",0),
        child_used=c.get("child_tool_used"))

def fmtc(n): return f"{n:,}"
def fmtn(k):
    m = metrics(k)
    if m is None: return f"| {k} | TIMEOUT | - | - | - | - | - | - |"
    return (f"| {m['wall']:.0f}s | {fmtc(m['pfin'])} | {fmtc(m['total_tok'])} | "
            f"{fmtc(m['cache_read'])} | {fmtc(m['cache_write'])} | ${m['cost']:.4f} | "
            f"{m['rework']} | {m['q']} |")

out = []
out.append("### Milestone 3 — Results (LIVE RUNS, completed 2026-08-10)")
out.append("")
out.append("Provider: `neuralwatt/kimi-k2.6` (real cloud; reports `cacheRead`/`cacheWrite`).")
out.append("P1 = pi-fleet copy (TS), P2 = bursa-futures copy (Python). Sandboxes in `/tmp/eval/`.")
out.append("Columns: wall | parent final input | total tokens (parent+child) | cacheRead (parent+child) | cacheWrite | cost | rework | quality.")
out.append("`rework` = parent turns after the first edit/write (non-interactive `-p`, so no human follow-ups; a proxy for self-correction). For pi-fleet the parent does one delegation, so parent rework is structurally ~0; the child's internal turns are opaque from the parent stream.")
out.append("")

for proj in ("p1","p2"):
    out.append(f"#### {proj.upper()} — {'pi-fleet (TS)' if proj=='p1' else 'bursa-futures (Python)'}")
    out.append("")
    out.append("| Task | Mode | Wall | Parent input | Total tokens | cacheRead | cacheWrite | Cost | Rework | Quality |")
    out.append("|-----|------|-----:|------------:|------------:|----------:|----------:|----:|------:|---------|")
    for t, label in [("t1","T1 trivial"),("t2","T2 explore-then-act"),("t3","T3 multi-step fix")]:
        for mode, ml in [("base","vanilla pi"),("fleet","pi-fleet")]:
            k = f"{proj}.{t}.{mode}"
            m = metrics(k)
            if m is None:
                out.append(f"| {label} | {ml} | TIMEOUT | - | - | - | - | - | - | - |")
            else:
                out.append(
                    f"| {label} | {ml} | {m['wall']:.0f}s | {fmtc(m['pfin'])} | {fmtc(m['total_tok'])} | "
                    f"{fmtc(m['cache_read'])} | {fmtc(m['cache_write'])} | ${m['cost']:.4f} | "
                    f"{m['rework']} | {m['q']} |"
                )
    # T4
    km = f"{proj}.t4.remember"; kr = f"{proj}.t4.recall_fleet"; kb = f"{proj}.t4.base"
    mm = metrics(km); mr = metrics(kr); mb = metrics(kb)
    out.append(f"| T4 remember | pi-fleet | {mm['wall']:.0f}s | {fmtc(mm['pfin'])} | {fmtc(mm['total_tok'])} | {fmtc(mm['cache_read'])} | {fmtc(mm['cache_write'])} | ${mm['cost']:.4f} | {mm['rework']} | (store) |")
    out.append(f"| T4 recall | pi-fleet (fresh) | {mr['wall']:.0f}s | {fmtc(mr['pfin'])} | {fmtc(mr['total_tok'])} | {fmtc(mr['cache_read'])} | {fmtc(mr['cache_write'])} | ${mr['cost']:.4f} | {mr['rework']} | {mr['q']} |")
    out.append(f"| T4 recall | vanilla pi | {mb['wall']:.0f}s | {fmtc(mb['pfin'])} | {fmtc(mb['total_tok'])} | {fmtc(mb['cache_read'])} | {fmtc(mb['cache_write'])} | ${mb['cost']:.4f} | {mb['rework']} | {mb['q']} |")
    out.append("")

# T3 cache series
out.append("#### T3 — 3× cache series (P1, direct coordinator, stable `sessionId`s)")
out.append("")
out.append("| Repeat | Wall | Planner in/out/cacheRead | Executor in/out/cacheRead |")
out.append("|-------:|-----:|--------------------------|---------------------------|")
for r in series:
    p = r["plannerUsage"] or {}; e = r["executorUsage"] or {}
    out.append(f"| {r['run']} | {r['wall_ms']/1000:.0f}s | {fmtc(p.get('input',0))}/{fmtc(p.get('output',0))}/{fmtc(p.get('cacheRead',0))} | {fmtc(e.get('input',0))}/{fmtc(e.get('output',0))}/{fmtc(e.get('cacheRead',0))} |")
out.append("")
pl_cr = [(r["plannerUsage"] or {}).get("cacheRead",0) for r in series]
ex_cr = [(r["executorUsage"] or {}).get("cacheRead",0) for r in series]
out.append(f"Planner cacheRead series: {pl_cr} — {'CLIMBS' if pl_cr==sorted(pl_cr) else 'NOT monotonic'}")
out.append(f"Executor cacheRead series: {ex_cr} — {'CLIMBS' if ex_cr==sorted(ex_cr) else 'NOT monotonic'}")
out.append("")

# Raw breakdown for verdicts
out.append("#### Raw breakdown (for verdicts)")
out.append("")
out.append("| Cell | parent_in | parent_out | parent_cacheRead | parent_turns | child_in | child_out | child_cacheRead |")
out.append("|------|----------:|----------:|----------------:|------------:|---------:|---------:|---------------:|")
keys = ["p1.t1.base","p1.t1.fleet","p1.t2.base","p1.t2.fleet","p1.t3.base","p1.t3.fleet",
        "p2.t1.base","p2.t1.fleet","p2.t2.base","p2.t2.fleet","p2.t3.base","p2.t3.fleet"]
for k in keys:
    m = metrics(k)
    if m: out.append(f"| {k} | {fmtc(m['p_in'])} | {fmtc(m['p_out'])} | {fmtc(m['p_cread'])} | {m['turns']} | {fmtc(m['c_in'])} | {fmtc(m['c_out'])} | {fmtc(m['c_cread'])} |")

pathlib.Path("/tmp/eval/tables.md").write_text("\n".join(out))
print("\n".join(out))