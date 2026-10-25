import type { ResearchProject } from "./project-state";

/** Question notes own research context; citation snapshots remain reusable graphs. */
export function questionPath(value: unknown): string | null {
	if (typeof value !== "string" || !value.startsWith("Research/Questions/") || !value.endsWith(".md")) return null;
	if (value.includes("\\") || Array.from(value).some(char => char.charCodeAt(0) < 32) || value.split("/").some(part => !part || part === "." || part === "..")) return null;
	return value;
}

export function questionLinks(value: unknown): string[] {
	return Array.isArray(value) ? [...new Set(value.map(questionPath).filter((path): path is string => !!path))] : [];
}

export function graphsForQuestion(projects: Record<string, ResearchProject>, question: string): ResearchProject[] {
	return Object.values(projects).filter(project => project.snapshot && (question ? questionLinks(project.questionPaths).includes(question) : questionLinks(project.questionPaths).length === 0)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function linkGraphToQuestion(project: ResearchProject, question: string): void {
	const path = questionPath(question);
	if (path) project.questionPaths = questionLinks([...(project.questionPaths ?? []), path]);
}
