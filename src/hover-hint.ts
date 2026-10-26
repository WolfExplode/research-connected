import { setTooltip } from "obsidian";

/** Use the host tooltip everywhere; native titles would create a second hover display. */
export function setHoverHint(element: HTMLElement, text: string): void {
	element.removeAttribute("title");
	setTooltip(element, text, { placement: "bottom" });
}
