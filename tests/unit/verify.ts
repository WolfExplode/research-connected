import { verifyWorkflow } from "./verify-workflow";
import { graphApiStatus } from "../../src/api-status";
// Host timers for offline adapters; browser tests supply the full window.
if (typeof window === "undefined") Object.assign(globalThis, { window: { setTimeout, clearTimeout } });

import assert from "node:assert/strict";
import { verifyWorkIdentity, verifyWorkIdentityPipeline } from "./verify-work-identity";
import { verifyEvidence } from "./verify-evidence";
import { verifyS2RateLimit } from "./verify-s2-rate-limit";
import { verifyProviderLimits } from "./verify-provider-limits";
import { verifyOpenAlexCache } from "./verify-openalex-cache";
import { verifyResearchLibrary } from "./verify-research-library";
import { verifyDoiRecovery } from "./verify-doi-recovery";
import { verifyComparison } from "./verify-comparison";
import { verifyConnections } from "./verify-connections";
import { verifyUi } from "./verify-ui";
import { classicInfluence, classicNodeIds, derivativeWorks, priorWorks } from "../../src/aggregates";
import { detectCommunities } from "../../src/communities";
import { buildCommunityCircles, buildCommunityRegions, communityTopicLabels, hitCommunityCircle, hitCommunityRegion } from "../../src/community-regions";
import { parseEmbed } from "../../src/embed-syntax";
import {
	edgeVisible,
	emptyFilter,
	evidenceText,
	focusNodes,
	nodeVisible,
	type GraphFilter,
} from "../../src/graph-filter";
import { authorYear, citationLabelAlpha, shortAuthor } from "../../src/labels";
import { placeLayout } from "../../src/layout-modes";
import { citationRadius, classicBreath, CLASSIC_BREATH_MS, fitViewScale, yearNormalizedCitations } from "../../src/visual";
import type { SimilarityGraph } from "../../src/neighborhood";
import { explainRelation, relationKind } from "../../src/relation";
import type { GraphEdge } from "../../src/types";
import { runForceLayout } from "../../src/layout";
import { diagnoseCandidate, loadNeighborhood, selectNeighbors, countsMismatched, type CrossrefReferenceSource, type ReconcileSource } from "../../src/neighborhood";
import { capQuery, explainStatus, openAlexErrorDetail, OpenAlexClient, OpenAlexError, SEMANTIC_QUERY_LIMIT, type GetJson } from "../../src/openalex";
import { classifyQuery, normalizeDoi, reconstructAbstract, toPaper } from "../../src/paper";
import { paperStateBadges } from "../../src/citation-evidence";
import { allowedExternalUrl, providerExternalUrl } from "../../src/safe-url";
import { DEFAULT_SETTINGS } from "../../src/settings-model";
import { restoreGraphSnapshot, savedProjectForSeed, saveGraphSnapshot, type ResearchProject } from "../../src/project-state";
import { buildSimilarity, pairScore } from "../../src/similarity";
import { buildSemanticScorer, embeddingCosine, tokenize } from "../../src/text-similarity";
import { buildPairSimilarity } from "../../src/diversity";
import { topicSimilarity, topicSimilarityColor } from "../../src/topic-similarity";
import { CrossrefClient, SemanticScholarClient } from "../../src/citation-sources";
import type { PaperNode } from "../../src/types";

function weighted(source: string, target: string, weight: number): GraphEdge {
	return {
		source,
		target,
		weight,
		coupling: 0,
		sharedRefs: 0,
		coCitation: 0,
		coCitedBy: 0,
		direct: "none",
	};
}

function filterish(patch: Partial<GraphFilter> = {}): GraphFilter {
	return { ...emptyFilter(), ...patch, kinds: { ...emptyFilter().kinds, ...patch.kinds } };
}

function paper(id: string, origin: PaperNode["origin"], citedByCount: number): PaperNode {
	return {
		id,
		title: id,
		year: 2020,
		citedByCount,
		authors: "A",
		authorList: ["A"],
		abstract: "",
		doiUrl: null,
		openAlexUrl: `https://openalex.org/${id}`,
		isSeed: origin === "seed",
		origin,
		language: null,
		workType: null,
		venue: null,
		retracted: false,
		concepts: [],
	};
}

function unit(): void {
	verifyWorkIdentity();
	const savedSeed = { ...paper("W1", "seed", 1), doiUrl: "https://doi.org/10.1234/seed" };
	const project: ResearchProject = {
		version: 1, seedId: "W1", name: "Saved", updatedAt: 1, views: [],
		snapshot: {
			version: 1, savedAt: 1, seedId: "W1", nodes: [savedSeed], edges: [], seedScore: [], warnings: [],
			strategies: { references: true, citations: true, related: true }, referenceLists: [], catalog: [savedSeed],
			citationEvidence: [], skippedNonResearch: 0,
		},
	};
	assert.equal(savedProjectForSeed({ W1: project }, { kind: "openalex", value: "https://openalex.org/W1" }), project);
	assert.equal(savedProjectForSeed({ W1: project }, { kind: "doi", value: "10.1234/SEED" }), project);
	assert.equal(savedProjectForSeed({ W1: project }, { kind: "doi", value: "10.1234/other" }), undefined);
	assert.deepEqual(classifyQuery("  10.1038/nature14539 "), {
		kind: "doi",
		value: "10.1038/nature14539",
	});
	assert.equal(normalizeDoi(" DOI:HTTPS://doi.org/10.1234/ABC). "), "10.1234/abc");
	assert.deepEqual(classifyQuery("https://doi.org/10.1038/nature14539"), {
		kind: "doi",
		value: "10.1038/nature14539",
	});
	assert.deepEqual(classifyQuery("https://openalex.org/W2919115771"), {
		kind: "openalex",
		value: "W2919115771",
	});
	assert.equal(classifyQuery("deep learning")?.kind, "search");
	assert.equal(classifyQuery("  "), null);

	assert.equal(
		reconstructAbstract({ Deep: [0], learning: [1], learns: [3], representations: [2] }),
		"Deep learning representations learns",
	);
	const topicPaper = toPaper({
		id: "https://openalex.org/W1",
		display_name: "Topic work",
		topics: [
			{ id: "https://openalex.org/T1", display_name: "Language", score: 0.9 },
			{ id: "https://openalex.org/T2", display_name: "Cognition", score: 0.4 },
		],
	}, "seed");
	assert.deepEqual(topicPaper?.topicTags?.map((topic) => topic.id), ["https://openalex.org/T1", "https://openalex.org/T2"]);
	assert.equal(topicPaper?.concepts[0], "Language");
	assert.equal(topicSimilarity(topicPaper?.topicTags, topicPaper?.topicTags), 1);
	assert.ok((topicSimilarity(topicPaper?.topicTags, [{ id: "https://openalex.org/T1", name: "Language", score: 1 }]) ?? 0) > 0);
	assert.equal(topicSimilarity(undefined, topicPaper?.topicTags), null);
	assert.notEqual(topicSimilarityColor(1), topicSimilarityColor(0));
	assert.match(topicSimilarityColor(1), /^rgb\(/, "embed WebGL parser only accepts rgb()");
	assert.match(topicSimilarityColor(null), /^rgb\(/);
	const topicGroups = communityTopicLabels([
		{ id: "a", title: "Language contact in Amazonia" },
		{ id: "b", title: "Language typology of classifiers" },
		{ id: "c", title: "Serial verb constructions" },
		{ id: "d", title: "Serial predicates in Papuan" },
	], new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]));
	assert.match(topicGroups.get(0) ?? "", /Amazonia|Contact|Typology/);
	assert.equal(topicGroups.get(1), "Serial");
	const shared = communityTopicLabels(
		[
			{ id: "a", title: "Language phonology of tone" },
			{ id: "b", title: "Language phonology overview" },
			{ id: "c", title: "Language morphology of verbs" },
			{ id: "d", title: "Language morphology notes" },
		],
		new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]),
	);
	assert.equal(shared.get(0), "Phonology", "共用标题词不拿来当圈名");
	assert.equal(shared.get(1), "Morphology");
	assert.notEqual(shared.get(0), shared.get(1));
	const communityRegions = buildCommunityRegions([
		{ id: "a", community: 0, x: 0, y: 0, shown: true },
		{ id: "b", community: 0, x: 20, y: 0, shown: true },
		{ id: "c", community: 0, x: 10, y: 20, shown: true },
	], 10, 3, 10, topicGroups);
	assert.match(communityRegions[0]?.label ?? "", /Amazonia|Contact|Typology/);
	const capped = buildCommunityRegions(
		[
			{ id: "a", community: 0, x: 0, y: 0, shown: true },
			{ id: "b", community: 0, x: 10, y: 0, shown: true },
			{ id: "c", community: 0, x: 0, y: 10, shown: true },
			{ id: "d", community: 1, x: 40, y: 0, shown: true },
			{ id: "e", community: 1, x: 50, y: 0, shown: true },
			{ id: "f", community: 1, x: 40, y: 10, shown: true },
			{ id: "g", community: 2, x: 80, y: 0, shown: true },
			{ id: "h", community: 2, x: 90, y: 0, shown: true },
			{ id: "i", community: 2, x: 80, y: 10, shown: true },
		],
		8,
		3,
		2,
	);
	assert.equal(capped.length, 2, "maximumRegions 截断生效");
	const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
	assert.equal(hitCommunityRegion(2, 2, [{ community: 0, members: 3, label: "A", points: triangle, cx: 3, cy: 3, left: 0, top: 0 }])?.community, 0);
	assert.equal(hitCommunityRegion(9, 9, [{ community: 0, members: 3, label: "A", points: triangle, cx: 3, cy: 3, left: 0, top: 0 }]), undefined);
	const disks = buildCommunityCircles(
		[
			{ id: "a", community: 0, x: 0, y: 0, shown: true },
			{ id: "b", community: 0, x: 10, y: 0, shown: true },
			{ id: "c", community: 0, x: 0, y: 10, shown: true },
		],
		4,
	);
	assert.equal(hitCommunityCircle(disks[0]!.cx, disks[0]!.cy, disks)?.community, 0);
	assert.equal(hitCommunityCircle(disks[0]!.cx + disks[0]!.radius + 2, disks[0]!.cy, disks), undefined);
	const outlier = buildCommunityCircles(
		[
			{ id: "a", community: 0, x: 0, y: 0, shown: true },
			{ id: "b", community: 0, x: 10, y: 0, shown: true },
			{ id: "c", community: 0, x: 0, y: 10, shown: true },
			{ id: "d", community: 0, x: 10, y: 10, shown: true },
			{ id: "far", community: 0, x: 400, y: 0, shown: true },
		],
		0,
	);
	assert.ok((outlier[0]?.radius ?? 0) < 80, "离群点不把社区圆撑成覆盖全图");
	const junk = communityTopicLabels(
		[
			{ id: "a", title: "Always evidential marking" },
			{ id: "b", title: "Always evidential morphology" },
		],
		new Map([["a", 0], ["b", 0]]),
	);
	assert.notEqual(junk.get(0), "Always");
	assert.equal(junk.get(0), "Evidential");
	const hapax = communityTopicLabels(
		[
			{ id: "a", title: "Case marking again" },
			{ id: "b", title: "Ergative systems" },
			{ id: "c", title: "Ergative alignment in the field" },
		],
		new Map([["a", 0], ["b", 0], ["c", 0]]),
	);
	assert.notEqual(hapax.get(0), "Again");
	assert.notEqual(hapax.get(0), "Systems");
	assert.match(hapax.get(0) ?? "", /Ergative/i);
	const fromFields = communityTopicLabels(
		[
			{ id: "a", title: "Notes", abstract: "Tariana evidential marking in discourse", concepts: ["Evidentiality", "Amazonia"] },
			{ id: "b", title: "Notes", abstract: "evidential morphology of verbs", concepts: ["Evidentiality"] },
			{ id: "c", title: "Notes", abstract: "serial verb constructions", concepts: ["Serial verbs"] },
			{ id: "d", title: "Notes", abstract: "serial predicates in Papuan", concepts: ["Serial verbs"] },
		],
		new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]),
	);
	assert.match(fromFields.get(0) ?? "", /Evidentiality/, "关键词优先于标题词");
	assert.doesNotMatch(fromFields.get(0) ?? "", / · /);
	assert.match(fromFields.get(1) ?? "", /Serial/i);
	const keywordFirst = communityTopicLabels(
		[
			{ id: "a", title: "Look at element fronting", concepts: ["Syntax"] },
			{ id: "b", title: "Look ahead and fronting", concepts: ["Syntax"] },
		],
		new Map([["a", 0], ["b", 0]]),
	);
	assert.equal(keywordFirst.get(0), "Syntax");
	const umbrella = communityTopicLabels(
		[
			{ id: "a", title: "A", concepts: ["Syntax, Semantics, Linguistic Variation", "Language, Discourse, Communication Strategies"] },
			{ id: "b", title: "B", concepts: ["Syntax, Semantics, Linguistic Variation"] },
			{ id: "c", title: "C", concepts: ["Discourse Analysis in Language Studies", "Cultural and political discourse analysis"] },
			{ id: "d", title: "D", concepts: ["Discourse Analysis in Language Studies"] },
		],
		new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]),
	);
	assert.ok((umbrella.get(0)?.length ?? 99) <= 28, "圈名截短");
	assert.match(umbrella.get(0) ?? "", /Syntax|Semantics/);
	assert.match(umbrella.get(1) ?? "", /Discourse/i);
	assert.notEqual(umbrella.get(0), umbrella.get(1));
	const abstractOnly = communityTopicLabels(
		[
			{ id: "a", title: "Notes", abstract: "Serial verb constructions in the field" },
			{ id: "b", title: "Notes", abstract: "Serial verb constructions again" },
		],
		new Map([["a", 0], ["b", 0]]),
	);
	assert.match(abstractOnly.get(0) ?? "", /Serial/i, "摘要重复短语可作圈名");
	const emptyLabel = communityTopicLabels([{ id: "a" }, { id: "b" }], new Map([["a", 0], ["b", 0]]));
	assert.equal(emptyLabel.get(0), "社区 1");

	assert.equal(allowedExternalUrl("https://doi.org/10.1038/nature14539")?.startsWith("https://doi.org/"), true);
	assert.equal(allowedExternalUrl("https://openalex.org/W1")?.startsWith("https://openalex.org/"), true);
	assert.equal(allowedExternalUrl("https://attacker.openalex.org/W1"), null);
	assert.equal(allowedExternalUrl("https://attacker.doi.org/10.1038/nature14539"), null);
	assert.equal(allowedExternalUrl("https://user@doi.org/10.1038/nature14539"), null);
	assert.equal(allowedExternalUrl("https://doi.org:8443/10.1038/nature14539"), null);
	assert.equal(allowedExternalUrl("https://evil.example/phish"), null);
	assert.equal(allowedExternalUrl("javascript:alert(1)"), null);
	assert.deepEqual(graphApiStatus(null, null, "", false), []);
	const apiNotices = graphApiStatus(null, null, "fetch failed", true);
	assert.equal(apiNotices.length, 2);
	assert.ok(apiNotices.some(message => message.includes("OpenCitations")));
	assert.ok(apiNotices.some(message => message.includes("fetch failed")));

	for (const url of ["https://publisher.example/paper.pdf", "http://repository.example/paper", "https://sci-hub.example/10.1234/test"]) {
		assert.equal(providerExternalUrl(url), url, "Provider links must reach the browser regardless of domain");
	}
	for (const url of ["javascript:alert(1)", "file:///tmp/paper.pdf", "data:text/html,test", "https://user:pass@example.org/paper", "invalid"]) {
		assert.equal(providerExternalUrl(url), null, "Reject unsafe provider URLs");
	}


	assert.match(explainStatus(404), /没有找到/);
	assert.match(explainStatus(429), /额度/);
	assert.match(explainStatus(400), /HTTP 400/, "A 400 without a body keeps the generic message");
	const tooLong = { error: "Search query too long", message: "Your search is too long (1561 characters; the limit is 1500). Very long pasted-text or Boolean searches are disproportionately expensive." };
	assert.equal(openAlexErrorDetail(tooLong), "Your search is too long (1561 characters; the limit is 1500).");
	assert.equal(openAlexErrorDetail({ error: "Invalid query parameters" }), "Invalid query parameters");
	assert.equal(openAlexErrorDetail("not json"), "");
	assert.match(explainStatus(400, openAlexErrorDetail(tooLong)), /the limit is 1500/, "A 400 says what OpenAlex rejected");
	const longQuery = `${"word ".repeat(400)}tail`;
	const cappedQuery = capQuery(longQuery);
	assert.ok(cappedQuery.length <= SEMANTIC_QUERY_LIMIT && longQuery.startsWith(cappedQuery) && longQuery[cappedQuery.length] === " ", "Semantic queries end on a word boundary within the OpenAlex limit");
	assert.equal(capQuery("x".repeat(1600)).length, SEMANTIC_QUERY_LIMIT, "A query with no spaces is cut at the limit");
	assert.equal(capQuery("short query"), "short query");

	const references = new Map<string, Set<string>>([
		["S", new Set(["A", "B", "C", "D"])],
		["P", new Set(["A", "B", "C", "Z"])],
		["Q", new Set(["X", "Y"])],
	]);
	const contexts = [new Set(["S", "P", "M"]), new Set(["S", "P"]), new Set(["S", "Q"])];
	assert.ok(pairScore("S", "P", references, contexts) > pairScore("S", "Q", references, contexts));

	const model = buildSimilarity({
		ids: ["S", "P", "Q"],
		seedId: "S",
		references,
		contexts,
	});
	assert.ok(model.edges.some((edge) => edge.source === "S" || edge.target === "S"));
	assert.ok((model.seedScore.get("P") ?? 0) > (model.seedScore.get("Q") ?? 0));
	const sp = model.edges.find(
		(edge) =>
			(edge.source === "S" && edge.target === "P") || (edge.source === "P" && edge.target === "S"),
	);
	assert.ok(sp, "expected an S–P edge");
	assert.ok((sp.structuralSimilarity ?? 0) > 0.7);
	assert.equal(sp.sharedRefs, 3);
	assert.equal(sp.coCitedBy, 2);
	assert.equal(sp.direct, "none");
	assert.equal(relationKind(sp), "cocitation");
	assert.match(explainRelation(sp, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共被引 2 次/);
	assert.match(explainRelation(sp, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共享参考文献 3 篇/);

	const cited = buildSimilarity({
		ids: ["S", "P"],
		seedId: "S",
		references: new Map([
			["S", new Set(["P", "A"])],
			["P", new Set(["A"])],
		]),
		contexts: [],
	});
	const citedEdge = cited.edges.find((edge) => edge.source !== edge.target);
	assert.ok(citedEdge);
	assert.equal(citedEdge.direct, citedEdge.source === "S" ? "source-cites-target" : "target-cites-source");
	assert.equal(relationKind(citedEdge), "direct");
	assert.match(
		explainRelation(citedEdge, { authors: "Yann LeCun", year: 2015 }, { authors: "David Rumelhart", year: 1986 }),
		/引用了/,
	);
	assert.equal(shortAuthor("Yann LeCun, Yoshua Bengio, Geoffrey E. Hinton"), "LeCun");
	assert.equal(shortAuthor("作者不详"), "佚名");
	assert.equal(authorYear({ authors: "Yann LeCun, Yoshua Bengio", year: 2015 }), "LeCun 2015");
	assert.equal(citationLabelAlpha(0, 0.5), 1, "最高被引恒显");
	assert.equal(citationLabelAlpha(3, 0.5), 0, "次档低缩放不显示");
	assert.ok(citationLabelAlpha(3, 1.0) > 0.5, "次档随放大淡入");
	assert.equal(citationLabelAlpha(20, 1.0), 0, "长尾需更近才出现");

	const weakEdge = weighted("S", "Q", 0.04);
	assert.equal(relationKind(weakEdge), "weak");
	const midCite = { ...weighted("A", "B", 0.2), structuralSimilarity: 0.4, coCitedBy: 2, coCitation: 0.4 };
	assert.equal(relationKind(midCite), "cocitation");
	const strongCouple = { ...weighted("A", "B", 0.5), structuralSimilarity: 0.6, sharedRefs: 8, coupling: 0.4 };
	assert.equal(relationKind(strongCouple), "coupling");
	const mutual = { ...weighted("S", "P", 0.2), structuralSimilarity: 0, direct: "mutual" as const };
	assert.equal(relationKind(mutual), "direct");
	const sample = paper("S", "seed", 10);
	const older = { ...paper("A", "reference", 3), year: 1980, language: "en", workType: "article", concepts: ["Deep learning"] };
	const peer = paper("B", "citation", 4);
	const nodesById = new Map([
		[sample.id, sample],
		[older.id, older],
		[peer.id, peer],
	]);
	assert.equal(nodeVisible(older, { ...filterish(), yearFrom: 1990 }), false);
	assert.equal(nodeVisible(sample, { ...filterish(), yearFrom: 1990 }), true);
	assert.equal(nodeVisible(older, { ...filterish(), language: "en" }), true);
	assert.equal(nodeVisible(older, { ...filterish(), concept: "deep learning" }), true);
	assert.equal(edgeVisible(midCite, nodesById, { ...filterish(), minCoCitedBy: 3 }), false);
	assert.equal(edgeVisible(midCite, nodesById, { ...filterish(), kinds: { ...filterish().kinds, cocitation: false } }), false);
	const directSeen = { ...weighted("S", "A", 0.2), direct: "source-cites-target" as const, coCitedBy: 1 };
	assert.equal(edgeVisible(directSeen, nodesById, { ...filterish(), minCoCitedBy: 9 }), true);
	const focus = focusNodes("A", [weighted("A", "B", 0.2), weighted("B", "S", 0.2)], () => true);
	assert.equal(focus?.has("S"), false);
	assert.equal(focus?.has("B"), true);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共享参考文献 0 篇/);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共被引 2 次/);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /OpenAlex/);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /不完整/);
	assert.equal(nodeVisible({ ...sample, year: 2015 }, { ...filterish(), scrubYear: 2010 }), true, "种子在年份筛选中保持显示");
	assert.equal(nodeVisible({ ...sample, isSeed: false, year: 2015 }, { ...filterish(), scrubYear: 2010 }), false);

	const layoutNodes = [
		{ ...paper("S", "seed", 1000), year: 2015, title: "Seed paper" },
		{ ...paper("A", "reference", 10), year: 1990, title: "Early" },
		{ ...paper("B", "citation", 100), year: 2010, title: "Middle" },
	];
	const temporal = placeLayout("temporal", layoutNodes, [], new Map([["S", 1], ["A", 0.2], ["B", 0.5]]));
	const at = (id: string) => temporal.find((node) => node.id === id);
	assert.ok((at("A")?.x ?? 0) < (at("B")?.x ?? 0));
	assert.ok((at("B")?.x ?? 0) < (at("S")?.x ?? 0));
	assert.ok((at("A")?.y ?? 0) < (at("B")?.y ?? 0));
	const radial = placeLayout("radial", layoutNodes, [], new Map([["S", 1], ["A", 0.2], ["B", 0.8]]));
	const radialSeed = radial.find((node) => node.id === "S");
	assert.equal(radialSeed?.x, 0);
	assert.equal(radialSeed?.y, 0);
	const radialA = radial.find((node) => node.id === "A");
	const radialB = radial.find((node) => node.id === "B");
	assert.ok(Math.hypot(radialA?.x ?? 0, radialA?.y ?? 0) > Math.hypot(radialB?.x ?? 0, radialB?.y ?? 0));
	const force = placeLayout("force2d", layoutNodes, [weighted("S", "A", 0.7), weighted("A", "B", 0.7)], new Map([["S", 1]]));
	assert.ok(force.every((node) => node.z === 0), "平面布局是二维地图");
	const forceSeed = force.find((node) => node.id === "S");
	assert.equal(forceSeed?.x, 0, "平面布局种子固定在中心");
	assert.equal(forceSeed?.y, 0);
	assert.ok(fitViewScale(400, 300, 4000, 3000) < 0.2, "大平面图能缩小进视口");
	assert.ok(fitViewScale(400, 300, 460, 300) > 0.5, "时间布局填满视口而不溢出");
	assert.equal(fitViewScale(400, 300, 40, 30) <= 8, true);
	const rLow = citationRadius(300, 300, 4000, false);
	const rHigh = citationRadius(4000, 300, 4000, false);
	assert.ok(rHigh / rLow > 2, "本页高低引用平方根拉开面积");
	assert.equal(citationRadius(100, 100, 100, false), citationRadius(200, 200, 200, false), "极差为 0 则同级");
	const breathA = classicBreath("paper-a", 0);
	const breathB = classicBreath("paper-b", 0);
	assert.ok(breathA >= 0 && breathA <= 1 && breathB >= 0 && breathB <= 1);
	assert.notEqual(breathA, breathB);
	assert.ok(Math.abs(classicBreath("paper-a", 0) - classicBreath("paper-a", CLASSIC_BREATH_MS)) < 1e-9);
	assert.ok(yearNormalizedCitations(3500, 1991, 2026) < yearNormalizedCitations(400, 2023, 2026), "同年等效被引用年归一");
	assert.equal(yearNormalizedCitations(80, 2026, 2026), 80);
	assert.equal(yearNormalizedCitations(80, null, 2026), 80);
	const yearSized = placeLayout("radial", [
		{ ...paper("S", "seed", 10), year: 2020 },
		{ ...paper("A", "reference", 3500), year: 1991 },
		{ ...paper("B", "citation", 400), year: 2023 },
	], [], new Map([["S", 1]]), 2026);
	assert.ok((yearSized.find((node) => node.id === "B")?.radius ?? 0) > (yearSized.find((node) => node.id === "A")?.radius ?? 0), "近年高被引年率比老文更大");

	const communities = detectCommunities(
		["A", "B", "C", "D", "E", "F"],
		[weighted("A", "B", 1), weighted("B", "C", 1), weighted("C", "A", 1), weighted("D", "E", 1), weighted("E", "F", 1), weighted("F", "D", 1)]
			.map((edge) => ({ ...edge, sharedRefs: 4, coupling: 0.5 })),
	);
	assert.equal(communities.get("A"), communities.get("B"));
	assert.equal(communities.get("B"), communities.get("C"));
	assert.notEqual(communities.get("A"), communities.get("D"));
	const weakOnly = detectCommunities(["A", "B"], [weighted("A", "B", 1)]);
	assert.notEqual(weakOnly.get("A"), weakOnly.get("B"));

	const seedPaper = { ...paper("S", "seed", 10), year: 2015, title: "Seed paper", authors: "Yann LeCun", doiUrl: "https://doi.org/10.1038/nature14539" };
	const early = { ...paper("A", "reference", 50), year: 1986, title: "Backprop", authors: "David Rumelhart" };
	const later = { ...paper("B", "citation", 20), year: 2018, title: "Later work", authors: "Ian Goodfellow" };
	const survey = { ...paper("C", "citation", 5), year: 2020, title: "Survey", authors: "Ada Lovelace" };
	const rankedGraph: SimilarityGraph = {
		nodes: [seedPaper, early, later],
		edges: [],
		seedScore: new Map([["S", 1], ["A", 0.4], ["B", 0.2]]),
		warnings: [],
		strategies: { references: true, citations: true, related: false },
		referenceLists: new Map([
			["S", ["A"]],
			["B", ["A", "S"]],
			["A", []],
			["C", ["S", "A", "B"]],
		]),
		catalog: [seedPaper, early, later, survey],
		skippedNonResearch: 0,
	};
	const auditGraph: SimilarityGraph = {
		...rankedGraph,
		nodes: [paper("W1", "seed", 10), { ...paper("W2", "reference", 5), doiUrl: "https://doi.org/10.1234/present" }],
		catalog: [paper("W1", "seed", 10), paper("W2", "reference", 5)],
		candidateAudit: [
			{ id: "W2", doi: "10.1234/present", source: "reference" },
			{ id: "W3", doi: "10.1234/unpicked", source: "citation" },
			{ id: "W4", doi: null, source: "related", rejection: "OpenAlex 将其归为「书评」" },
		],
		excludedIds: ["W5"],
	};
	assert.equal(diagnoseCandidate(auditGraph, "10.1234/present").title, "已在当前图谱中");
	assert.equal(diagnoseCandidate(auditGraph, "W2", undefined, 2010).title, "已在图谱中，当前年份范围将其隐藏");
	assert.equal(diagnoseCandidate(auditGraph, "10.1234/unpicked").title, "已采样，未入选图谱节点");
	assert.match(diagnoseCandidate(auditGraph, "W4").detail, /书评/);
	assert.equal(diagnoseCandidate(auditGraph, "W5").title, "已从当前图谱删除");
	assert.equal(diagnoseCandidate(auditGraph, "W6").title, "当前候选记录中没有这篇论文");
	const savedAudit = restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(auditGraph))));
	assert.deepEqual(savedAudit?.excludedIds, ["W5"]);
	assert.equal(savedAudit?.candidateAudit?.length, 3);
	const visible = new Set(["S", "A", "B"]);
	const priors = priorWorks(rankedGraph, visible);
	assert.equal(priors[0]?.paper.id, "A");
	assert.equal(priors[0]?.count, 2);
	assert.equal(priors.some((item) => item.paper.id === "S"), false);
	const derivatives = derivativeWorks(rankedGraph, visible);
	assert.equal(derivatives.find((item) => item.paper.id === "C")?.count, 3);
	assert.equal(derivatives.some((item) => item.paper.id === "B"), true);
	const classicNodes = [
		{ ...paper("S", "seed", 10), year: 2015 },
		{ ...paper("A", "reference", 100), year: 1991 },
		{ ...paper("B", "citation", 10), year: 2010 },
		{ ...paper("C", "citation", 10), year: 2024 },
	];
	const classicEdges = [
		{ ...weighted("B", "A", 0.8), direct: "source-cites-target" as const },
		{ ...weighted("C", "A", 0.8), direct: "source-cites-target" as const },
		{ ...weighted("S", "A", 0.8), direct: "source-cites-target" as const },
		{ ...weighted("S", "C", 0.5), direct: "source-cites-target" as const },
		{ ...weighted("B", "C", 0.5), direct: "source-cites-target" as const },
	];
	const classics = classicNodeIds(classicNodes, classicEdges, 2026);
	assert.equal(classics.has("A"), true, "图内多次被引的老文是经典");
	assert.equal(classics.has("C"), false, "近年文即使被引也不标经典");
	assert.equal(classics.has("S"), false, "种子不标经典辉光");
	const glow = classicInfluence(
		[
			{ ...paper("S", "seed", 10), year: 2015 },
			{ ...paper("A", "reference", 3500), year: 1991 },
			{ ...paper("B", "reference", 80), year: 1990 },
			{ ...paper("C", "citation", 10), year: 2024 },
		],
		[
			{ ...weighted("S", "A", 0.8), direct: "source-cites-target" as const },
			{ ...weighted("B", "A", 0.8), direct: "source-cites-target" as const },
			{ ...weighted("S", "B", 0.8), direct: "source-cites-target" as const },
			{ ...weighted("A", "B", 0.5), direct: "source-cites-target" as const },
		],
		2026,
	);
	assert.ok((glow.get("A") ?? 0) > (glow.get("B") ?? 1), "年归一被引更高则辉光范围更大");
	assert.equal(glow.has("C"), false);

	const picked = selectNeighbors(
		{ ...DEFAULT_SETTINGS, maxNodes: 20, includeRelated: false },
		{
			reference: [paper("W1", "reference", 10), paper("W2", "reference", 50)],
			citation: [paper("W3", "citation", 5), paper("W9", "citation", 100)],
			related: [paper("W4", "related", 1)],
		},
		"W0",
	);
	assert.ok(picked.length <= 19);
	assert.equal(picked.some((item) => item.id === "W4"), false);
	assert.equal(picked.some((item) => item.origin === "citation"), true);
	const duplicateReference = toPaper({ id: "W10", display_name: "Duplicate", doi: "10.1234/dup", publication_year: 2020 }, "reference");
	const duplicateCitation = toPaper({ id: "W11", display_name: "Duplicate", doi: "https://doi.org/10.1234/DUP.", publication_year: 2020 }, "citation");
	assert.ok(duplicateReference && duplicateCitation);
	const merged = selectNeighbors(
		{ ...DEFAULT_SETTINGS, maxNodes: 20, includeRelated: false },
		{ reference: [duplicateReference], citation: [duplicateCitation], related: [] },
		"W0",
	);
	assert.equal(merged.length, 1, "same DOI is one neighborhood candidate");

	const nodes = [
		{ id: "S", x: 0, y: 0, radius: 14 },
		{ id: "A", x: 0, y: 0, radius: 10 },
		{ id: "B", x: 0, y: 0, radius: 8 },
		{ id: "C", x: 0, y: 0, radius: 12 },
	];
	runForceLayout(
		nodes,
		[weighted("S", "A", 0.8), weighted("S", "B", 0.2), weighted("A", "C", 0.5)],
		"S",
		new Map([
			["S", 1],
			["A", 0.8],
			["B", 0.2],
			["C", 0.4],
		]),
	);
	const seed = nodes.find((node) => node.id === "S");
	assert.equal(seed?.x, 0);
	assert.equal(seed?.y, 0);
	for (const node of nodes) {
		assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
	}
	const xs = nodes.map((node) => node.x);
	assert.ok(Math.max(...xs) - Math.min(...xs) > 20);

	const parsed = parseEmbed(
		"doi: 10.1038/nature14539\n# note\nmaxNodes: 40\nheight: 100\ndepth: 2\n",
	);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.deepEqual(parsed.spec.target, { kind: "doi", value: "10.1038/nature14539" });
		assert.equal(parsed.spec.maxNodes, 40);
		assert.equal(parsed.spec.height, 280);
		assert.equal(parsed.spec.depth, 2);
		assert.equal(parsed.spec.position, "inline");
		assert.equal(parsed.spec.width, "100%");
		assert.equal(parsed.spec.align, "left");
		assert.equal(parsed.spec.labels, "author-year");
	}
	const placed = parseEmbed(
		"doi: 10.1038/nature14539\nposition: float-right\nwidth: 60%\nalign: center\nlabels: both\n",
	);
	assert.equal(placed.ok, true);
	if (placed.ok) {
		assert.equal(placed.spec.position, "float-right");
		assert.equal(placed.spec.width, "60%");
		assert.equal(placed.spec.align, "center");
		assert.equal(placed.spec.labels, "both");
	}
	const floated = parseEmbed("doi: 10.1038/nature14539\nposition: float-left\nlabels: off\nwidth: 100\n");
	assert.equal(floated.ok, true);
	if (floated.ok) {
		assert.equal(floated.spec.position, "float-left");
		assert.equal(floated.spec.labels, "off");
		assert.equal(floated.spec.width, "240px");
	}
	assert.equal(parseEmbed("doi: 10.1038/nature14539\nposition: sidebar\n").ok, false);
	assert.equal(parseEmbed("doi: 10.1038/nature14539\nlabels: authors\n").ok, false);
	const ranged = parseEmbed(
		"doi: 10.1038/nature14539\nyearFrom: 2010\nyearTo: 1990\nlanguage: EN\ntype: article\nconcept: Deep learning\nminCoCite: 2\n",
	);
	assert.equal(ranged.ok, true);
	if (ranged.ok) {
		assert.equal(ranged.spec.yearFrom, 1990);
		assert.equal(ranged.spec.yearTo, 2010);
		assert.equal(ranged.spec.language, "en");
		assert.equal(ranged.spec.workType, "article");
		assert.equal(ranged.spec.concept, "Deep learning");
		assert.equal(ranged.spec.minCoCite, 2);
		assert.equal(ranged.spec.layout, "temporal");
		assert.equal(ranged.spec.color, "topic");
	}
	const laidOut = parseEmbed("doi: 10.1038/nature14539\nlayout: force2d\ncolor: year\n");
	assert.equal(laidOut.ok, true);
	if (laidOut.ok) {
		assert.equal(laidOut.spec.layout, "force2d", "force layouts stay distinct");
		assert.equal(laidOut.spec.color, "year", "color: year is honored");
	}
	const forceDefault = parseEmbed("doi: 10.1038/nature14539\nlayout: force2d\n");
	assert.equal(forceDefault.ok, true);
	if (forceDefault.ok) assert.equal(forceDefault.spec.color, "community", "plane layout defaults to community color");
	const legacy3d = parseEmbed("doi: 10.1038/nature14539\nlayout: force3d\n");
	assert.equal(legacy3d.ok, true);
	if (legacy3d.ok) assert.equal(legacy3d.spec.layout, "force2d", "force3d maps to force2d");
	const topicColor = parseEmbed("doi: 10.1038/nature14539\ncolor: topic\n");
	assert.equal(topicColor.ok, true);
	if (topicColor.ok) assert.equal(topicColor.spec.color, "topic");
	assert.equal(parseEmbed("doi: 10.1038/nature14539\nlayout: sidebar\n").ok, false);
	const kumuEmbed = parseEmbed("doi: 10.1038/nature14539\nlayout: kumu\n");
	assert.equal(kumuEmbed.ok, true, "历史 kumu 值仍被接受");
	if (kumuEmbed.ok) assert.equal(kumuEmbed.spec.layout, "force2d", "kumu 映射到合并后的平面布局");
	const yearNodes = [
		{ ...paper("Y1", "seed", 1), year: 2000 },
		{ ...paper("Y2", "reference", 1), year: 2010 },
		{ ...paper("Y3", "citation", 1), year: 2020 },
	];
	const yearPlaced = placeLayout("temporal", yearNodes, [], new Map());
	assert.equal(yearPlaced[1]!.x - yearPlaced[0]!.x, yearPlaced[2]!.x - yearPlaced[1]!.x, "horizontal year distance is linear and not jittered");
	const bare = parseEmbed("  W2919115771  ");
	assert.equal(bare.ok, true);
	if (bare.ok) assert.deepEqual(bare.spec.target, { kind: "openalex", value: "W2919115771" });
	const tall = parseEmbed("doi: 10.1038/nature14539\nheight: 2000\nmaxNodes: 5\n");
	assert.equal(tall.ok, true);
	if (tall.ok) {
		assert.equal(tall.spec.height, 900);
		assert.equal(tall.spec.maxNodes, 20);
		assert.equal(tall.spec.depth, 1);
	}
	assert.equal(parseEmbed("deep learning").ok, false);
	assert.equal(parseEmbed("").ok, false);
}

const getJson: GetJson = async (url, init) => {
	const response = await fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

async function live(): Promise<void> {
	const client = new OpenAlexClient(getJson, { apiKey: "", contactEmail: "" });
	const graph = await loadNeighborhood(
		client,
		{ kind: "doi", value: "10.1038/nature14539" },
		DEFAULT_SETTINGS,
	);
	const seed = graph.nodes.find((node) => node.isSeed);
	assert.ok(seed, "missing seed");
	assert.match(seed.title, /deep learning/i);
	assert.ok(seed.citedByCount > 1000);
	assert.equal(seed.openAlexUrl.startsWith("https://openalex.org/W"), true);
	assert.ok(graph.nodes.length > 8, `expected a neighborhood, got ${graph.nodes.length}`);
	assert.ok(graph.nodes.length <= DEFAULT_SETTINGS.maxNodes);
	assert.ok(graph.edges.length >= 5, `expected edges, got ${graph.edges.length}`);
	assert.ok(graph.edges.some((edge) => edge.source === seed.id || edge.target === seed.id));
	assert.ok(graph.referenceLists.has(seed.id));
	assert.ok(graph.catalog.some((node) => node.id === seed.id));
	const priors = priorWorks(graph, new Set(graph.nodes.map((node) => node.id)));
	assert.ok(priors.length > 0, "expected prior works from the sampled reference lists");
	assert.ok(priors.every((item) => item.count >= 2));
	assert.ok(
		graph.nodes.some((node) => /Long Short-Term Memory|Gradient-based learning/i.test(node.title)),
		"expected a highly cited reference of the seed in the map",
	);
	const titles = graph.nodes
		.slice()
		.sort((a, b) => b.citedByCount - a.citedByCount)
		.slice(0, 6)
		.map((node) => `${node.origin} ${node.year ?? "?"} ${node.title}`)
		.join("\n  ");
	console.log(
		`live map: ${graph.nodes.length} nodes, ${graph.edges.length} edges, warnings=${graph.warnings.join(",") || "none"}\n  ${titles}`,
	);
}

/** 语义通道（proposal-5 Phase A）：分词、BM25 排序、缺失降级。 */
function semanticChecks(): void {
	const tokens = tokenize("The Role of Tone in 声调系统 Grammar");
	assert.ok(tokens.includes("role") && tokens.includes("tone") && tokens.includes("grammar"), "英文词干入词表");
	assert.ok(tokens.includes("声调") && tokens.includes("系统"), "中文走字 bigram");
	assert.ok(!tokens.includes("the"), "停用词过滤");

	const seed = {
		...paper("S", "seed", 100),
		title: "Evidentiality and epistemic modality",
		concepts: ["Linguistics"],
		abstract: "How languages encode information source.",
	};
	const near = {
		...paper("A", "reference", 10),
		title: "Epistemic modality and evidential markers",
		concepts: ["Linguistics"],
		abstract: "Markers of information source in grammar.",
	};
	const far = {
		...paper("B", "reference", 10),
		title: "Quantum chromodynamics lattice",
		concepts: ["Physics"],
		abstract: "Gauge fields on discrete lattices.",
	};
	const scorer = buildSemanticScorer(seed, [near, far]);
	const nearScore = scorer.score(near);
	const farScore = scorer.score(far);
	assert.ok(nearScore !== null && farScore !== null);
	assert.ok(nearScore > farScore, "语义相关论文分数更高");
	assert.ok(nearScore <= 1 && farScore >= 0);

	const blankSeed = { ...paper("S2", "seed", 1), title: "", concepts: [] };
	const blankNode = { ...paper("C", "reference", 1), title: "", concepts: [] };
	assert.equal(buildSemanticScorer(blankSeed, [blankNode]).score(blankNode), null, "无文本无主题时不可用");

	const topicSeed = { ...paper("S3", "seed", 1), title: "", concepts: [], topicTags: [{ id: "T1", name: "Syntax", score: 0.9 }] };
	const topicNode = { ...paper("D", "reference", 1), title: "", concepts: [], topicTags: [{ id: "T1", name: "Syntax", score: 0.8 }] };
	const topicScore = buildSemanticScorer(topicSeed, [topicNode]).score(topicNode);
	assert.ok(topicScore !== null && topicScore > 0.9, "文本缺失时主题余弦兜底");

	// Phase B：SPECTER2 向量通道
	assert.equal(embeddingCosine([1, 0], [1, 0]), 1, "同向向量余弦为 1");
	assert.equal(embeddingCosine([1, 0], [0, 1]), 0, "正交向量余弦为 0");
	assert.equal(embeddingCosine([1, 0], [-1, 0]), 0, "负余弦钳到 0");
	assert.equal(embeddingCosine([1, 0], [1, 0, 0]), null, "维度不符不可用");
	assert.equal(embeddingCosine([0, 0], [1, 0]), null, "零向量不可用");

	// 双侧有向量时向量压过文本：far 与 seed 文本无关，但向量同向 → 高分。
	const embSeed = { ...paper("SE", "seed", 1), title: "Evidentiality and epistemic modality", concepts: ["Linguistics"] };
	const embNear = { ...paper("EN", "reference", 1), title: "Quantum chromodynamics lattice", concepts: ["Physics"] };
	const embFar = { ...paper("EF", "reference", 1), title: "Epistemic modality and evidential markers", concepts: ["Linguistics"] };
	const embScorer = buildSemanticScorer(
		embSeed,
		[embNear, embFar],
		new Map([
			["SE", [1, 0, 0]],
			["EN", [0.9, 0.1, 0]],
			["EF", [0, 1, 0]],
		]),
	);
	const embNearScore = embScorer.score(embNear);
	const embFarScore = embScorer.score(embFar);
	assert.ok(embNearScore !== null && embFarScore !== null);
	assert.ok(embNearScore > embFarScore, "有向量时按向量余弦排序，而非文本重合");
	assert.ok(Math.abs(embNearScore - embeddingCosine([1, 0, 0], [0.9, 0.1, 0])!) < 1e-9, "无主题时向量分独立成项");

	// 单侧缺向量：该节点退回本地 BM25，其余节点仍走向量。
	const mixedScorer = buildSemanticScorer(seed, [near, far], new Map([["S", [1, 0]], ["A", [0.9, 0.1]]]));
	const mixedNear = mixedScorer.score(near);
	const mixedFar = mixedScorer.score(far);
	assert.ok(mixedNear !== null && mixedNear > 0.6, "有向量的节点走向量通道");
	assert.ok(mixedFar !== null && mixedFar < 0.5, "缺向量的节点退回本地 BM25");

	// seed 缺向量：全图退回本地通道。
	const noSeedVec = buildSemanticScorer(seed, [near, far], new Map([["A", [1, 0]]]));
	assert.equal(noSeedVec.score(near), buildSemanticScorer(seed, [near, far]).score(near), "seed 无向量时等同本地通道");
}

/** Phase C：pair diversity similarity 与 MMR 选择行为。 */
function diversityChecks(): void {
	// pair similarity：对称、[0,1]、空特征 null、memo 一致。
	const pa = { ...paper("PA", "reference", 10), title: "Graph neural networks for molecules", concepts: ["Chemistry"] };
	const pb = { ...paper("PB", "reference", 10), title: "Molecular graph networks", concepts: ["Chemistry"] };
	const pc = { ...paper("PC", "reference", 10), title: "Climate policy instruments", concepts: ["Economics"] };
	const blank = { ...paper("PD", "reference", 10), title: "", concepts: [] };
	const sim = buildPairSimilarity([pa, pb, pc, blank]);
	const ab = sim(pa, pb);
	assert.ok(ab !== null && ab > 0 && ab <= 1, "相关论文相似度在 (0,1]");
	assert.equal(sim(pa, pb), sim(pb, pa), "pair similarity 对称");
	assert.equal(sim(pa, pb), ab, "memoized 结果一致");
	assert.equal(sim(blank, pa), null, "空特征返回 null");
	assert.ok((sim(pa, pc) ?? 1) < ab, "无关论文相似度更低");

	// MMR：首项取最高相关性；候选充足时相似的克隆体被挤出名额；确定性；null 不惩罚。
	const rel = (p: PaperNode): number => p.citedByCount / 100;
	const clones = Array.from({ length: 20 }, (_, i) => ({
		...paper(`C${i}`, "reference", 100),
		title: "evidentiality in grammar",
		concepts: [] as string[],
	}));
	const distinctTitles = ["quantum lattice gauge", "climate policy carbon", "neural synapse cortex", "protein folding enzyme", "bayesian causal inference"];
	const distinct = distinctTitles.map((title, i) => ({
		...paper(`D${i}`, "reference", 90),
		title,
		concepts: [] as string[],
	}));
	const groups = { reference: [...clones, ...distinct], citation: [], related: [] };
	const pickSettings = { maxNodes: 20, includeReferences: true, includeCitations: false, includeRelated: false };
	const noMmr = new Set(selectNeighbors(pickSettings, groups, "SEED", rel).map((p) => p.id));
	assert.equal([...noMmr].filter((id) => id.startsWith("D")).length, 0, "无 MMR 时克隆体占满名额");
	const mmr = { sim: buildPairSimilarity([...clones, ...distinct]), lambda: 0.5 };
	const withMmr = selectNeighbors(pickSettings, groups, "SEED", rel, mmr).map((p) => p.id);
	assert.deepEqual(
		new Set(selectNeighbors({ ...pickSettings, diversifyResults: false }, groups, "SEED", rel, mmr).map(p => p.id)),
		noMmr,
		"Disabling diversity removes the penalty even when pair similarity is available",
	);
	assert.equal(withMmr.filter((id) => id.startsWith("D")).length, 5, "MMR 挤出克隆体，纳入相异候选");
	assert.equal(withMmr[0], "C0", "MMR 首项仍是最高相关性");
	assert.deepEqual(
		selectNeighbors(pickSettings, groups, "SEED", rel, mmr).map((p) => p.id),
		withMmr,
		"MMR 结果确定",
	);
	assert.deepEqual(
		new Set(selectNeighbors(pickSettings, groups, "SEED", rel, { sim: () => null, lambda: 0.5 }).map((p) => p.id)),
		noMmr,
		"相似度全 null 时等同无 MMR",
	);

	// 跨池去重与 related 配额不受 MMR 影响。
	const dupRef = { ...paper("X1", "reference", 80), doiUrl: "https://doi.org/10.9/dup", title: "alpha topic" };
	const dupCite = { ...paper("X2", "citation", 70), doiUrl: "https://doi.org/10.9/dup", title: "alpha topic" };
	const deduped = selectNeighbors(
		{ maxNodes: 20, includeReferences: true, includeCitations: true, includeRelated: false },
		{ reference: [dupRef], citation: [dupCite], related: [] },
		"SEED",
		rel,
		mmr,
	);
	assert.equal(deduped.length, 1, "同 DOI 跨池去重");
	assert.equal(deduped[0]?.origin, "reference", "保留更高 origin 的版本");
	const relatedPool = Array.from({ length: 12 }, (_, i) => ({
		...paper(`R${i}`, "related", 90 - i),
		title: `related topic ${i % 3} variant ${i}`,
	}));
	const referencePool = Array.from({ length: 15 }, (_, i) => ({
		...paper(`F${i}`, "reference", 80 - i),
		title: `reference work ${i % 4} part ${i}`,
	}));
	const quota = selectNeighbors(
		{ maxNodes: 20, includeReferences: true, includeCitations: false, includeRelated: true },
		{ reference: referencePool, citation: [], related: relatedPool },
		"SEED",
		rel,
		mmr,
	);
	assert.equal(quota.length, 19, "名额填满");
	assert.ok(quota.filter((p) => p.origin === "related").length <= 6, "related 配额上限不变");
}

async function main(): Promise<void> {
	await verifyWorkflow();
	await verifyS2RateLimit();
	await verifyProviderLimits();
	await verifyOpenAlexCache();
	await verifyResearchLibrary();
	unit();
	await verifyWorkIdentityPipeline();
	semanticChecks();
	diversityChecks();
	await verifyEvidence();
	await verifyDoiRecovery();
	verifyComparison();
	verifyConnections();
	verifyUi();
	await cursorPaging();
	await reconcileOffline();
	console.log("unit checks passed");
	if (process.argv.includes("--offline")) return;
	try {
		await live();
	} catch (error) {
		console.warn("live OpenAlex check failed once, retrying", error);
		await live();
	}
	console.log("verify passed");
}

/** Reconcile: S2 counts flag a mismatch, and a missing reference list is backfilled into an edge. */
async function reconcileOffline(): Promise<void> {
	assert.equal(countsMismatched(1328, 2), true, "book review vs book-scale citations mismatch");
	assert.equal(countsMismatched(60, 6), true);
	assert.equal(countsMismatched(49, 1), false, "small counts are too noisy to flag");
	assert.equal(countsMismatched(100, null), false, "no S2 record is not a mismatch");
	assert.equal(countsMismatched(100, 60), false);

	// Unified node-state badges: severity order, clean node paints nothing.
	const badges = paperStateBadges(
		{ retracted: true, workType: "book-review" },
		{ mismatched: true, refsAdded: 3 },
	);
	assert.deepEqual(
		badges.map((badge) => badge.label),
		["⚠ 已撤稿", "书评", "⚠ 数据源差异", "S2 回填 3 条"],
	);
	assert.ok(badges.slice(0, 3).every((badge) => badge.tone === "warn"));
	assert.equal(paperStateBadges({ retracted: false, workType: "article" }, null).length, 0);
	assert.equal(paperStateBadges({ workType: "review" }, { mismatched: false, refsAdded: 0 }).length, 0, "综述是研究内容，不进徽章");

	const seedWork = {
		id: "https://openalex.org/W1",
		display_name: "Seed paper",
		doi: "https://doi.org/10.1/seed",
		referenced_works: [],
		authorships: [],
		type: "article",
	};
	const neighborWork = {
		id: "https://openalex.org/W2",
		display_name: "Neighbor paper",
		doi: "https://doi.org/10.1/neighbor",
		publication_year: 2020,
		cited_by_count: 500,
		authorships: [],
		type: "article",
	};
	const mock: GetJson = async (url) => {
		const parsed = new URL(url);
		if (parsed.pathname === "/works/W1") return seedWork;
		const filter = parsed.searchParams.get("filter") ?? "";
		if (filter === "cited_by:W1") return { results: [neighborWork] };
		if (filter.startsWith("openalex:")) {
			return { results: [{ id: neighborWork.id, referenced_works: [], abstract_inverted_index: null }] };
		}
		return { results: [] };
	};
	const client = new OpenAlexClient(mock, { apiKey: "", contactEmail: "" });
	const reconcile: ReconcileSource = {
		bulkCounts: async () => new Map([["10.1/neighbor", { citationCount: 5, referenceCount: 30 }]]),
		referenceDois: async () => ["10.1/seed"],
	};
	const crossref: CrossrefReferenceSource = {
		referenceDois: async (doi) => doi === "10.1/seed" ? ["10.1/neighbor"] : [],
	};
	const graph = await loadNeighborhood(
		client,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, maxNodes: 20 },
		undefined,
		reconcile,
		crossref,
	);
	const check = graph.crossCheck?.get("W2");
	assert.ok(check, "cross-check recorded for the neighbor");
	assert.equal(check.mismatched, true, "500 vs 5 is an order-of-magnitude mismatch");
	assert.equal(check.refsAdded, 1, "one backfilled link into the graph");
	assert.ok(graph.rawReferenceLists?.get("W2")?.some((ref) => ref.source === "semantic-scholar" && ref.doi === "10.1/seed"));
	const edge = graph.edges.find(
		(item) =>
			(item.source === "W2" && item.target === "W1") || (item.source === "W1" && item.target === "W2"),
	);
	assert.ok(edge && edge.direct !== "none", "backfilled reference creates a direct edge");
	const evidence = graph.citationEvidence?.get("W2", "W1");
	assert.ok(evidence?.sources.includes("semantic-scholar"), "backfilled edge credits Semantic Scholar");
	assert.ok(!evidence?.sources.includes("openalex"), "backfilled edge is not credited to OpenAlex");
	const crossrefEvidence = graph.citationEvidence?.get("W1", "W2");
	assert.ok(crossrefEvidence?.sources.includes("crossref"), "Crossref-only reference credits Crossref");
	assert.ok(!crossrefEvidence?.sources.includes("openalex"), "Crossref backfill is not misattributed to OpenAlex");
	assert.equal(graph.crossCheck?.get("W1")?.crossrefRefsAdded, 1);
	assert.ok(graph.rawReferenceLists?.get("W1")?.some((ref) => ref.source === "crossref" && ref.doi === "10.1/neighbor"));

	// C2 入选原因快照：仅 picked 节点入图，semantic 缺失保留 null。
	const rankW2 = graph.selectionRank?.get("W2");
	assert.ok(rankW2, "picked 节点有入选快照");
	assert.ok(typeof rankW2.authority === "number" && typeof rankW2.relevance === "number");
	assert.equal(rankW2.semantic, null, "无主题且标题无有效词项时语义为 null");
	assert.equal(rankW2.relevance, rankW2.authority, "语义缺失时相关性等于权威分");
	assert.equal(graph.selectionRank?.has("W1"), false, "种子不进 selectionRank");
	assert.ok(graph.candidateAudit?.some((item) => item.id === "W2" && !item.rejection));
	const retractedClient = new OpenAlexClient(async (url, init) => {
		if (new URL(url).searchParams.get("filter") === "cited_by:W1") return { results: [{ ...neighborWork, is_retracted: true }] };
		return mock(url, init);
	}, { apiKey: "", contactEmail: "" });
	const excluded = await loadNeighborhood(
		retractedClient,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, excludeRetracted: true, s2Reconcile: false, maxNodes: 20 },
	);
	assert.equal(excluded.nodes.some((paper) => paper.id === "W2"), false);
	assert.match(diagnoseCandidate(excluded, "W2").detail, /排除已撤稿/);
	const flagged = await loadNeighborhood(
		retractedClient,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, s2Reconcile: false, maxNodes: 20 },
	);
	assert.ok((flagged.selectionRank?.get("W2")?.relevance ?? 1) <= 0.1, "retracted candidate is not ranked highly");

	// Toggle off: no cross-check, no backfill.
	const off = await loadNeighborhood(
		client,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, s2Reconcile: false, maxNodes: 20 },
		undefined,
		reconcile,
	);
	assert.equal(off.crossCheck, undefined);

	// Phase B：批量请求带 embedding 字段时，向量进入语义通道。
	const vecReconcile: ReconcileSource = {
		embeddingModel: "specter2",
		bulkCounts: async (_dois, opts) =>
			new Map([
				["10.1/seed", { citationCount: 100, referenceCount: 10, ...(opts?.embedding ? { embedding: [1, 0, 0] } : {}) }],
				["10.1/neighbor", { citationCount: 500, referenceCount: 30, ...(opts?.embedding ? { embedding: [0.9, 0.1, 0] } : {}) }],
			]),
		referenceDois: async () => [],
	};
	const withVec = await loadNeighborhood(
		client,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, maxNodes: 20 },
		undefined,
		vecReconcile,
	);
	assert.equal(withVec.semanticMode, "embedding", "seed 有向量时启用向量通道");
	assert.equal(withVec.semanticModel, "specter2", "记录向量模型名");
	assert.ok((withVec.semanticScores?.get("W2") ?? 0) > 0.9, "同向向量给出高语义分");

	// 设置关掉语义向量：同一 reconcile 也只走本地通道。
	const vecOff = await loadNeighborhood(
		client,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, semanticEmbedding: false, maxNodes: 20 },
		undefined,
		vecReconcile,
	);
	assert.equal(vecOff.semanticMode, "local", "semanticEmbedding 关闭时退回本地通道");

	// 客户端降级：embedding 字段被拒时自动退回纯计数请求，交叉比对不受影响。
	const requestedFields: string[] = [];
	const s2 = new SemanticScholarClient(async () => ({}), "", async (url) => {
		const fields = new URL(url).searchParams.get("fields") ?? "";
		requestedFields.push(fields);
		if (fields.includes("embedding")) throw new Error("400 unknown field");
		return [{ externalIds: { DOI: "10.1/x" }, citationCount: 7, referenceCount: 3 }];
	});
	const counts = await s2.bulkCounts(["10.1/x"], { embedding: true });
	assert.equal(counts.get("10.1/x")?.citationCount, 7, "embedding 被拒后仍拿到计数");
	assert.equal(requestedFields[0], "citationCount,referenceCount,externalIds,embedding.specter_v2", "SPECTER2 requires an explicitly versioned API field");
	assert.ok(requestedFields.some((f) => !f.includes("embedding")), "失败后降级为纯计数请求");

	// 正常返回 embedding：解析向量与模型名。
	const s2ok = new SemanticScholarClient(async () => ({}), "", async () => [
		{ externalIds: { DOI: "10.1/y" }, citationCount: 1, referenceCount: 1, embedding: { model: "specter_v2", vector: Array(768).fill(0.1) } },
	]);
	const okCounts = await s2ok.bulkCounts(["10.1/y"], { embedding: true });
	assert.deepEqual(okCounts.get("10.1/y")?.embedding, Array(768).fill(0.1));
	assert.equal(s2ok.embeddingModel, "specter_v2");
	const crossrefClient = new CrossrefClient(async (url) => {
		assert.match(url, /api\.crossref\.org\/works\/10\.1\/test/);
		return { message: { abstract: "<jats:p>Uses &amp; tests</jats:p>", reference: [{ DOI: "10.1/ref" }, { unstructured: "No DOI" }] } };
	}, "test@example.org");
	assert.equal(await crossrefClient.abstract("10.1/test"), "Uses & tests");
	assert.deepEqual(await crossrefClient.referenceDois("10.1/test"), ["10.1/ref"]);
}
async function cursorPaging(): Promise<void> {
	const requested: string[] = [];
	const pages: Record<string, { results: Array<{ id: string }>; next: string | null }> = {
		"*": { results: [{ id: "W1" }, { id: "W2" }], next: "p2" },
		p2: { results: [{ id: "W3" }], next: "p3" },
		p3: { results: [], next: null },
	};
	const mock: GetJson = async (url) => {
		requested.push(url);
		const cursor = new URL(url).searchParams.get("cursor") ?? "*";
		const page = pages[cursor];
		if (!page) throw new Error(`unexpected cursor ${cursor}`);
		return { results: page.results, meta: { next_cursor: page.next } };
	};
	const client = new OpenAlexClient(mock, { apiKey: "", contactEmail: "" });
	const works = await client.citingSeed("W0", 200, 5);
	assert.deepEqual(works.map((work) => work.id), ["W1", "W2", "W3"]);
	assert.equal(requested.length, 3, "stops when a page comes back empty");
	assert.ok(new URL(requested[0] ?? "").searchParams.get("cursor") === "*");
	assert.ok(new URL(requested[1] ?? "").searchParams.get("cursor") === "p2");

	const single = await client.referencedBySeed("W0", 80);
	assert.equal(single.length, 2, "single-page mode ignores cursors");
	assert.equal(new URL(requested[3] ?? "").searchParams.get("cursor"), null);

	const sampled = await client.sampleWorks(
		"cites:W0",
		2,
		2,
		"cited_by_count:desc",
		2,
		(work) => work.id !== "W1",
	);
	assert.deepEqual(sampled.works.map((work) => work.id), ["W2", "W3"]);
	assert.deepEqual(sampled.rejected.map((work) => work.id), ["W1"]);
	assert.equal(sampled.rawFetched, 3, "filtered sampling reads the next page");
	assert.equal(sampled.filtered, 1);
	assert.equal(sampled.requests, 2);
	assert.equal(sampled.duplicates, 0);
	assert.equal(sampled.pages, 2);
	const partialClient = new OpenAlexClient(async (url) => {
		const cursor = new URL(url).searchParams.get("cursor");
		if (cursor === "*") return { results: [{ id: "W4" }], meta: { next_cursor: "failed-page" } };
		throw new OpenAlexError("page two unavailable");
	}, { apiKey: "", contactEmail: "" });
	const partial = await partialClient.sampleWorks("cites:W0", 2, 1, undefined, 2, () => true);
	assert.deepEqual(partial.works.map((work) => work.id), ["W4"], "keep successful pages if a later page fails");
	assert.equal(partial.error, "page two unavailable");
	assert.equal(partial.requests, 2, "failed page attempts count as requests");
	assert.equal(partial.exhausted, false);
	const duplicateClient = new OpenAlexClient(async (url) => {
		const cursor = new URL(url).searchParams.get("cursor");
		return cursor === "*"
			? { results: [{ id: "W5" }], meta: { next_cursor: "p2" } }
			: { results: [{ id: "W5" }, { id: "W6" }], meta: { next_cursor: null } };
	}, { apiKey: "", contactEmail: "" });
	const uniqueSample = await duplicateClient.sampleWorks("cites:W0", 2, 1, undefined, 2, () => true);
	assert.deepEqual(uniqueSample.works.map((work) => work.id), ["W5", "W6"]);
	assert.equal(uniqueSample.duplicates, 1, "duplicate records do not consume sample quota");
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
