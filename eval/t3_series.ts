/**
 * eval-benefits Milestone 3 — T3 cache series.
 *
 * Runs the planner/executor coordinator 3x on the SAME task, resetting the
 * planted bug to an identical state before each run, with deterministic
 * approval (approve=true) and the coordinator's stable sessionIds
 * (pi-fleet.planner / pi-fleet.executor). Reads the instrumented
 * plannerUsage/executorUsage to see whether cacheRead climbs across repeated
 * calls — the core differentiator claim.
 *
 * Run: node --experimental-strip-types eval/t3_series.ts
 */
import { ModelRuntime, resolveCliModel } from "@earendil-works/pi-coding-agent";
import { runPlanExecute } from "../src/coordinator.ts";
import * as fs from "node:fs";

const CWD = "/tmp/eval/p1";
const BUG_SRC = "/tmp/eval/p1-markers.bug.txt";
const TARGET = CWD + "/src/markers.ts";
const MODEL = "neuralwatt/kimi-k2.6";
const TASK =
	"In src/markers.ts there is a bug: the marker [planner_requires_approval] is never detected by parsePlan. Find and fix the bug.";

async function main() {
	const runtime = await ModelRuntime.create();
	const { model, error } = resolveCliModel({ cliModel: MODEL, modelRuntime: runtime });
	if (!model) throw new Error("model not resolved: " + error);

	const series = [];
	for (let i = 1; i <= 3; i++) {
		fs.copyFileSync(BUG_SRC, TARGET); // reset to identical planted-bug state
		const t0 = Date.now();
		const res = await runPlanExecute({
			task: TASK,
			cwd: CWD,
			plannerModel: model,
			executorModel: model,
			approve: async () => true,
		});
		series.push({
			run: i,
			status: res.status,
			wall_ms: Date.now() - t0,
			plannerUsage: res.plannerUsage ?? null,
			executorUsage: res.executorUsage ?? null,
		});
	}
	fs.writeFileSync("/tmp/eval/t3_series.json", JSON.stringify(series, null, 2));
	console.log(JSON.stringify(series, null, 2));
}

main().catch((e) => {
	console.error("FATAL", e);
	process.exit(1);
});