# Research Connected alignment design system

Research Connected is a focused Obsidian research tool for exploring one seed paper. The main pane is an investigation workspace; the note embed is a compact reading-context widget. They must feel like one product, with the embed using the same visual grammar at a smaller scale.

## Direction

Use a quiet editorial instrument: warm paper surfaces, graphite text, restrained ochre accent, thin dividers, compact controls, no gradients, no decorative marketing UI. Align the two shells around the same three zones: a status/header strip, a graph stage with a left control rail, and a bottom action/sheet strip.

## Required consistency

- Same font stack, colors, radii, borders, button states and tab vocabulary in pane and embed.
- Same visual hierarchy: primary action is ochre filled; secondary actions are quiet paper buttons; selected controls use an ochre hairline or soft tint.
- Same bottom sheet geometry and collapsed summary treatment.
- Same drawer anatomy: title, short help line, legend, filters, then secondary controls.
- Keep the pane's seed input/search controls and the embed's reload action as surface-specific content, but place them in equivalent header height and spacing.
- Keep graph canvas visually dominant. Controls should be compact and never compete with nodes.

## Tokens

- `--rc-surface: #f6f5f2`
- `--rc-canvas: #ffffff`
- `--rc-ink: #3a3f45`
- `--rc-muted: #6b7280`
- `--rc-quiet: #9aa0a6`
- `--rc-border: rgba(60,64,70,.12)`
- `--rc-accent: #a67c2e`
- `--rc-accent-soft: rgba(166,124,46,.12)`
- `--rc-radius-sm: 6px`
- `--rc-radius-md: 10px`
- `--rc-space: 8px`

## Implementation target

Prefer a CSS token layer in `styles.css` and shared classes over duplicated `.cpo-root`/`.cpo-embed` rules. Preserve the existing DOM and behavior; this is a visual alignment pass.

Use ONLY the fonts, colors, spacing, and component styles defined here. Do not introduce any fonts, colors, or visual styles not in the design system.
