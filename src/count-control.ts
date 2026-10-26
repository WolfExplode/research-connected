import { tr } from "./i18n";

/** Shared editable count with a compact menu of suggested values. */
export function createCountControl(options: {
	label: string;
	presetLabel: string;
	initial: number;
	max: number;
	presets: readonly number[];
	onChange: () => void;
}) {
	const element = createEl("label", { cls: "cpo-count-field" });
	element.append(createSpan({ text: tr("显示", "Show") }));
	const control = createSpan({ cls: "cpo-result-limit-control" });
	const input = createEl("input");
	input.type = "number"; input.min = "1"; input.max = String(options.max); input.step = "1";
	input.value = String(options.initial); input.setAttribute("aria-label", options.label);
	const presets = createEl("select"); presets.setAttribute("aria-label", options.presetLabel);
	const placeholder = createEl("option", { value: "", text: "▾" }); placeholder.hidden = true;
	presets.append(placeholder);
	for (const value of options.presets) presets.append(createEl("option", { value: String(value), text: String(value) }));
	presets.value = "";
	control.append(input, presets); element.append(control);
	const commit = (): void => {
		const value = input.valueAsNumber;
		input.value = String(Number.isFinite(value) ? Math.max(1, Math.min(options.max, Math.round(value))) : options.initial);
		options.onChange();
	};
	input.addEventListener("change", commit);
	input.addEventListener("keydown", event => {
		if (event.key !== "Enter") return;
		event.preventDefault(); event.stopPropagation();
		// Blurring commits a changed field through the native change event.
		input.blur();
	});
	presets.addEventListener("change", () => {
		if (!presets.value) return;
		input.value = presets.value; presets.value = "";
		commit(); presets.blur();
	});
	return { element, input, setDisabled(disabled: boolean) { input.disabled = presets.disabled = disabled; } };
}
