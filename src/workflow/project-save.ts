/** Debounce view changes, and make the final pending write explicit at disposal. */
export function createProjectSave(save: () => void, delay = 500) {
	let timer: number | undefined;
	let disposed = false;
	const cancel = (): void => { if (timer !== undefined) window.clearTimeout(timer); timer = undefined; };
	return {
		schedule(): void {
			if (disposed) return;
			cancel();
			timer = window.setTimeout(() => { timer = undefined; save(); }, delay);
		},
		flush(): void { if (!disposed) { cancel(); save(); } },
		dispose(): void {
			if (disposed) return;
			disposed = true;
			if (timer !== undefined) { cancel(); save(); }
		},
	};
}
