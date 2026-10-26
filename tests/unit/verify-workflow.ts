import assert from "node:assert/strict";
import { ReadingSaveError, saveReadingState } from "../../src/workflow/reading-state";
import { createProjectSave } from "../../src/workflow/project-save";
import type { ResearchProject } from "../../src/project-state";
import type { PaperNode } from "../../src/types";

export async function verifyWorkflow(): Promise<void> {
	const paper: PaperNode = { id: "W1", title: "Seed", isSeed: true, origin: "seed", doiUrl: null, year: 2000,
		citedByCount: 1, authors: "Author", authorList: ["Author"], abstract: "", openAlexUrl: "https://openalex.org/W1",
		language: "en", workType: "article", venue: null, retracted: false, concepts: [] };
	const projects: Record<string, ResearchProject> = {};
	let disk = "unread", writes = 0, failPersist = false;
	const change = { projects, seedId: paper.id, paper, reading: "read" as const, previous: "unread" as const,
		persist: (): void => { writes++; if (failPersist) throw new Error("disk full"); disk = projects.W1!.paperStates!.W1!.reading; } };
	await assert.rejects(saveReadingState({ ...change, syncNote: async () => {
		projects.W1!.paperStates!.W1!.source = "Edited elsewhere";
		throw new Error("ambiguous note");
	} }), ReadingSaveError);
	assert.equal(writes, 2, "a failed note sync must persist its compensation");
	assert.equal(disk, "unread");
	assert.equal(projects.W1!.paperStates!.W1!.reading, "unread");
	assert.equal(projects.W1!.paperStates!.W1!.source, "Edited elsewhere", "rollback must retain unrelated state edits");
	failPersist = true;
	await assert.rejects(saveReadingState(change), ReadingSaveError);
	assert.equal(projects.W1!.paperStates!.W1!.reading, "unread");
	failPersist = false;
	await assert.rejects(saveReadingState({ ...change, syncNote: async () => { failPersist = true; throw new Error("note failed"); } }),
		(error: unknown) => error instanceof ReadingSaveError && error.reading === "read");
	assert.equal(projects.W1!.paperStates!.W1!.reading, disk, "a failed compensation must expose the last confirmed saved value");
	failPersist = false;
	await saveReadingState({ ...change, reading: "to-read" });
	assert.equal(disk, "to-read", "errors must not block later writes");

	let release!: () => void;
	const waiting = new Promise<void>(resolve => { release = resolve; });
	const first = saveReadingState({ ...change, syncNote: async () => { await waiting; throw new Error("late failure"); } });
	const second = saveReadingState({ ...change, reading: "unread" });
	const failed = assert.rejects(first, ReadingSaveError);
	release(); await Promise.all([failed, second]);
	assert.equal(disk, "unread", "a late failure must not undo a subsequent queued reading choice");

	let saved = 0;
	const save = createProjectSave(() => { saved++; }, 10);
	save.schedule(); save.schedule(); save.dispose(); save.dispose(); save.schedule();
	await new Promise(resolve => setTimeout(resolve, 25));
	assert.equal(saved, 1, "disposal must flush the last pending state once and stop its timer");
}
