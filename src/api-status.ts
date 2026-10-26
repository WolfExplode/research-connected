import { tr } from "./i18n";
import type { SimilarityGraph } from "./neighborhood";
import type { PaperLibraryService } from "./library-panel";

/** Report known limitations; an absent error is not proof every provider was queried. */
export function graphApiStatus(graph: SimilarityGraph | null, libraryService: PaperLibraryService | null | undefined, libraryError: string, citationsIncomplete: boolean): string[] {
	const messages: string[] = [];
	const labels: Record<string, string> = {
		references: "OpenAlex references", citations: "OpenAlex citations", related: "OpenAlex related works",
		details: "OpenAlex paper details", crosscheck: "Semantic Scholar",
	};
	for (const warning of graph?.warnings ?? []) messages.push(tr(`${labels[warning] ?? warning}：请求未完成，结果可能不完整。`, `${labels[warning] ?? warning}: calls incomplete; results may be partial.`));
	if (graph?.pagingLimited) messages.push(tr("OpenAlex：采样仅限第一页。", "OpenAlex: sampling limited to the first page."));
	if (citationsIncomplete) messages.push(tr("OpenCitations：部分核对请求未完成。", "OpenCitations: some verification calls incomplete."));
	if (libraryError) messages.push(tr(`文库检索未完成：${libraryError}`, `Library search incomplete: ${libraryError}`));
	const embeddings = libraryService?.embeddingStatus?.();
	if (embeddings?.state === "rate-limited") messages.push(tr("SPECTER2：请求受限；15 分钟后下次加载时重试。", "SPECTER2: rate limited; retry on next load after 15 minutes."));
	else if (embeddings?.state === "error" || embeddings?.state === "failed") messages.push(tr("SPECTER2：向量请求未完成。", "SPECTER2: embedding calls incomplete."));
	if (embeddings?.pending) messages.push(tr(`SPECTER2：${embeddings.pending} 篇论文待处理。`, `SPECTER2: ${embeddings.pending} papers pending.`));
	return messages;
}
