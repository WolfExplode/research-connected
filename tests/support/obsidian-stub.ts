// Obsidian uses aria-label for its styled hover tooltip.
export function setTooltip(element: HTMLElement, text: string): void {
	if (text) element.setAttribute("aria-label", text);
	else element.removeAttribute("aria-label");
}

export function getLanguage(): string {
	return typeof document !== "undefined" ? document.documentElement.lang || "en" : "zh-CN";
}

export const moment = { locale: getLanguage };

type ElementOptions = { text?: string; value?: string; cls?: string; attr?: Record<string, string> };
function previewElement<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (options?.text !== undefined) element.textContent = options.text;
	if (options?.value !== undefined) element.setAttribute("value", options.value);
	if (options?.cls) element.className = options.cls;
	for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
	return element;
}

// Implement host helpers only for the standalone browser preview.
if (typeof document !== "undefined") {
	if (!Element.prototype.instanceOf) Object.defineProperty(Element.prototype, "instanceOf", {
		value(this: Element, constructor: typeof Element) { return this instanceof constructor; },
		configurable: true,
	});
	Object.assign(window, {
		createSvg: (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag),
		createDiv: (options?: ElementOptions) => previewElement("div", options),
		createSpan: (options?: ElementOptions) => previewElement("span", options),
		createEl: previewElement,
	});
}
