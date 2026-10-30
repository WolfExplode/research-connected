import type { PaperNode } from "./types";
import type { ReadingStatus } from "./project-state";

export interface LibraryPaperState {
	note: string | null;
	held: boolean;
	bookmark: boolean;
	reason?: string;
	error?: string;
	ambiguous?: boolean;
}
export interface LibraryBookmark { paper: PaperNode; note: string; reading: ReadingStatus }

/** Vault-owned paper state. Graph/project snapshots never own bookmarks or downloads. */
export interface PaperLibrary {
	read(paper: PaperNode): LibraryPaperState;
	busy?(paper: PaperNode): boolean;
	setBookmark(paper: PaperNode, value: boolean): Promise<void>;
	save(paper: PaperNode, onProgress?: (message: string) => void): Promise<LibraryPaperState>;
	bookmarks(): LibraryBookmark[];
	open(note: string): void;
}
