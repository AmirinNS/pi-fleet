/**
 * eval-benefits follow-up — Experiment A: no-sessionId control.
 *
 * The T3 series showed planner cacheRead climbing 12160 -> 16864 -> 50432 with
 * the STABLE pi-fleet.planner sessionId. This control asks: is that climb caused
 * by the stable sessionId (provider session-affinity routing to one warm cache
 * node), or would it happen with ANY sessionId (i.e. kimi's automatic,
 * session-agnostic prefix caching)?
 *
 * Runs the planner subagent 3x with a STABLE sessionId, then 3x with a RANDOM
 * (unique-per-call) sessionId, resetting the planted bug to an identical state
 * before each call. Compares the cacheRead series.
 *
 * Run: node --experimental-strip-types eval/t3_control.ts
 */
import { ModelRuntime, resolveCliModel } from "@earendil-works/pi-coding-agent";
import { runSubagent } from "../src/subagent.ts";
import { loadProfile } from "../src/profiles.ts";
import * as fs from "node:fs";

const CWD = "/tmp/eval/p1";
const BUG_SRC = "/tmp/eval/p1-markers.bug.txt";
const TARGET = CWD + "/src/markers.ts";
const MODEL = process.env.EVAL_MODEL ?? "neuralwatt/kimi-k2.6";
const TASK =
	"In src/markers.ts there is a bug: the marker [planner_requires_approval] is never detected by parsePlan. Find and fix the bug.";

async function plannerRun(model: any, sessionId: string) {
	fs.copyFileSync(BUG_SRC, TARGET); // identical planted-bug state each run
	const t0 = Date.now();
	const res = await runSubagent({
		profile: loadProfile("planner"),
		prompt: TASK,
		cwd: CWD,
		model,
		sessionId,
	});
	return { sessionId, wall_ms: Date.now() - t0, usage: res.usage ?? null, answer: res.answer.slice(0, 120) };
}

async function main() {
	const runtime = await ModelRuntime.create();
	const { model, error } = resolveCliModel({ cliModel: MODEL, modelRuntime: runtime });
	if (!model) throw new Error("model not resolved: " + error);

	const stable: any[] = [];
	const random: any[] = [];
	const STABLE_ID = "control.stable.planner";
	for (let i = 1; i <= 3; i++) stable.push(await plannerRun(model, STABLE_ID));
	for (let i = 1; i <= 3; i++) random.push(await plannerRun(model, `control.rand.planner.${i}.${Date.now()}`));

	const tag = MODEL.replace(/\//g, "_");
	const out = { model: MODEL, stable, random };
	fs.writeFileSync(`/tmp/eval/t3_control_${tag}.json`, JSON.stringify(out, null, 2));
	console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });