import type { PaperLibrary } from "../paper-library";
import type { ResearchProject } from "../project-state";

/** Clear a legacy flag only after the vault write and plugin receipt both succeed. */
export async function migrateProjectBookmarks(projects: Record<string, ResearchProject>, library: PaperLibrary, persist: () => Promise<void>): Promise<void> {
	for (const [projectId, project] of Object.entries(projects)) {
		for (const state of Object.values(project.paperStates ?? {})) {
			if (!state.staged) continue;
			await library.migrateBookmark(state.paper, `${project.name || projectId} · ${state.source}`, state.reading);
			state.staged = false;
			try { await persist(); } catch (error) { state.staged = true; throw error; }
		}
	}
}
