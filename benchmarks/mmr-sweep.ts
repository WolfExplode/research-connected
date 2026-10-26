import { buildPairSimilarity } from "../src/diversity";
import { selectNeighbors, type MmrOptions } from "../src/neighborhood";
import { syntheticNeighborhood } from "./perf-fixture";
import type { PaperNode } from "../src/types";

/**
 * MMR λ 离线 sweep（proposal-5 Phase C / LIN-12 第 2 条）。
 * 在确定性合成邻域上对每个 λ 报告：
 *   relevance  = 入选节点平均归一化相关性（越高越好）
 *   diversity  = 1 − 入选节点两两相似度均值（越高越好）
 *   topicCoverage = 入选节点覆盖的主题簇数 / 池内主题簇数
 * 默认 λ 取相关性损失小、多样性增益明显的拐点。
 */

const neighborhood = syntheticNeighborhood(120, 42);
const { seed, groups, pool } = neighborhood;
const sim = buildPairSimilarity(pool);

const impact = (paper: PaperNode): number => Math.log1p(Math.max(0, paper.citedByCount));
const maxImpact = Math.max(1e-9, ...pool.map(impact));
const relevanceOf = (paper: PaperNode): number => impact(paper) / maxImpact;

const settings = { maxNodes: 50, includeReferences: true, includeCitations: true, includeRelated: true };

console.log(["lambda", "picked", "relevance", "diversity", "topicCoverage"].join("\t"));
for (const lambda of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
	const mmr: MmrOptions = { sim, lambda };
	const picked = selectNeighbors(settings, groups, seed.id, relevanceOf, mmr);
	const relevance = picked.reduce((sum, paper) => sum + relevanceOf(paper), 0) / picked.length;
	let pairSum = 0;
	let pairCount = 0;
	for (let i = 0; i < picked.length; i++) {
		for (let j = i + 1; j < picked.length; j++) {
			const value = sim(picked[i]!, picked[j]!);
			if (value === null) continue;
			pairSum += value;
			pairCount++;
		}
	}
	const diversity = pairCount > 0 ? 1 - pairSum / pairCount : 1;
	const topics = new Set(picked.map((paper) => paper.concepts[0] ?? paper.title.split(" ")[0]));
	const poolTopics = new Set(pool.map((paper) => paper.concepts[0] ?? paper.title.split(" ")[0]));
	console.log(
		[lambda.toFixed(1), String(picked.length), relevance.toFixed(3), diversity.toFixed(3), `${topics.size}/${poolTopics.size}`].join("\t"),
	);
}
