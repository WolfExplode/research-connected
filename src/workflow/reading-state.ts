import { tr } from "../i18n";
import { updateProjectPaperState, type ReadingStatus, type ResearchProject } from "../project-state";
import type { PaperNode } from "../types";
import { paperHasId } from "../work-identity";

/** The reading value last confirmed on disk, including a failed compensation. */
export class ReadingSaveError extends Error {
	constructor(readonly reading: ReadingStatus, message: string, readonly retrySync = false) { super(message); }
}

interface ReadingChange {
	projects: Record<string, ResearchProject>;
	seedId: string;
	paper: PaperNode;
	reading: ReadingStatus;
	previous: ReadingStatus;
	persist: () => Promise<void> | void;
	syncNote?: (paper: PaperNode, reading: ReadingStatus) => Promise<void>;
}

// Pane and embed adapters share the settings object. Serialize changes to the
// same paper so a late failed note write cannot roll back a newer reading choice.
const queues = new WeakMap<ReadingChange["projects"], Map<string, Promise<void>>>();

export function readingChangePending(projects: ReadingChange["projects"], seedId: string, paper: PaperNode): boolean {
	const canonical = projects[seedId]?.snapshot?.nodes.find(item => paperHasId(item, paper.id)) ?? paper;
	return queues.get(projects)?.has(canonical.doiUrl?.toLowerCase() || canonical.id) ?? false;
}

export function readingChangesPending(projects: ReadingChange["projects"]): boolean {
	return Boolean(queues.get(projects)?.size);
}

export function saveReadingState(change: ReadingChange): Promise<void> {
	const canonical = change.projects[change.seedId]?.snapshot?.nodes.find(paper => paperHasId(paper, change.paper.id));
	if (canonical) change = { ...change, paper: canonical };
	let queue = queues.get(change.projects);
	if (!queue) { queue = new Map(); queues.set(change.projects, queue); }
	const key = change.paper.doiUrl?.toLowerCase() || change.paper.id;
	const task = (queue.get(key) ?? Promise.resolve()).catch(() => {}).then(() => commitReading(change));
	queue.set(key, task);
	const release = (): void => { if (queue.get(key) === task) queue.delete(key); };
	void task.then(release, release);
	return task;
}

async function commitReading(change: ReadingChange): Promise<void> {
	const { projects, seedId, paper, reading, persist, syncNote } = change;
	const previous = projects[seedId]?.paperStates?.[paper.id]?.reading ?? change.previous;
	const set = (value: ReadingStatus): void => { updateProjectPaperState(projects, seedId, paper, { reading: value }); };
	set(reading);
	try { await persist(); }
	catch {
		set(previous);
		throw new ReadingSaveError(previous, tr("阅读状态保存失败，请重试。", "Could not save reading status. Try again."));
	}
	try { await syncNote?.(paper, reading); }
	catch {
		set(previous);
		try { await persist(); }
		catch {
			// The initial write succeeded. Keep that confirmed value visible instead
			// of claiming a rollback that could not be saved.
			set(reading);
			throw new ReadingSaveError(reading, tr("阅读状态已保存，但笔记同步及回退保存失败。请重试同步。", "Reading status was saved, but note sync and rollback failed. Retry synchronization."), true);
		}
		throw new ReadingSaveError(previous, tr("笔记同步失败，阅读状态已恢复。请检查匹配的笔记后重试。", "Note sync failed; reading status was restored. Check the matching note and retry."));
	}
}
