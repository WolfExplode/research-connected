import { tr } from "./i18n";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 260;
const MAX_WIDTH = 480;

export interface SidebarResizeOptions {
	defaultWidth?: number;
	minWidth?: number;
	maxWidth?: number;
	onResize?: () => void;
}

/** Shared resizable evidence rail used by the pane and the note embed. */
export function mountSidebarResize(
	handle: HTMLElement,
	sidebar: HTMLElement,
	options: SidebarResizeOptions = {},
): () => void {
	const min = options.minWidth ?? MIN_WIDTH;
	const max = options.maxWidth ?? MAX_WIDTH;
	const initial = clampSidebarWidth(options.defaultWidth ?? DEFAULT_WIDTH, min, max);
	handle.classList.add("cpo-sidebar-resizer");
	handle.setAttribute("role", "separator");
	handle.setAttribute("aria-orientation", "vertical");
	handle.setAttribute("aria-label", tr("调整论文详情与关联依据面板宽度", "Resize paper details and evidence panel"));
	handle.tabIndex = 0;
	let width = initial;
	let dragging = false;
	let startX = 0;
	let startWidth = width;

	const apply = (next: number): void => {
		width = clampSidebarWidth(next, min, max);
		sidebar.style.setProperty("--cpo-sidebar-width", `${width}px`);
		handle.setAttribute("aria-valuemin", String(min));
		handle.setAttribute("aria-valuemax", String(max));
		handle.setAttribute("aria-valuenow", String(width));
		options.onResize?.();
	};
	const reset = (): void => apply(initial);
	apply(initial);

	const onPointerDown = (event: PointerEvent): void => {
		if (sidebar.closest(".is-narrow")) return;
		dragging = true;
		startX = event.clientX;
		startWidth = width;
		handle.classList.add("is-dragging");
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// Some embedded WebViews do not support pointer capture.
		}
		event.preventDefault();
		event.stopPropagation();
	};
	const onPointerMove = (event: PointerEvent): void => {
		if (!dragging) return;
		apply(startWidth - (event.clientX - startX));
		event.preventDefault();
	};
	const onPointerUp = (event: PointerEvent): void => {
		if (!dragging) return;
		dragging = false;
		handle.classList.remove("is-dragging");
		try {
			if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
		} catch {
			// The pointer was not captured.
		}
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		const step = event.shiftKey ? 80 : 24;
		if (event.key === "ArrowLeft") apply(width + step);
		else if (event.key === "ArrowRight") apply(width - step);
		else if (event.key === "Home") reset();
		else return;
		event.preventDefault();
		event.stopPropagation();
	};
	handle.addEventListener("pointerdown", onPointerDown);
	handle.addEventListener("pointermove", onPointerMove);
	handle.addEventListener("pointerup", onPointerUp);
	handle.addEventListener("pointercancel", onPointerUp);
	handle.addEventListener("keydown", onKeyDown);
	handle.addEventListener("dblclick", reset);
	return () => {
		handle.removeEventListener("pointerdown", onPointerDown);
		handle.removeEventListener("pointermove", onPointerMove);
		handle.removeEventListener("pointerup", onPointerUp);
		handle.removeEventListener("pointercancel", onPointerUp);
		handle.removeEventListener("keydown", onKeyDown);
		handle.removeEventListener("dblclick", reset);
		handle.classList.remove("is-dragging");
		sidebar.style.removeProperty("width");
		sidebar.style.removeProperty("--cpo-sidebar-width");
	};
}

export function clampSidebarWidth(value: number, min = MIN_WIDTH, max = MAX_WIDTH): number {
	return Math.min(max, Math.max(min, Math.round(value)));
}
