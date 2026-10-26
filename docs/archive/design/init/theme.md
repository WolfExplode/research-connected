# Research Connected UI theme

## Token summary

- Typeface: Obsidian interface font, with CJK fallbacks (`Segoe UI`, `PingFang SC`, `Noto Sans SC`, `Microsoft YaHei`).
- Surfaces: warm paper `#f6f5f2`, white canvas `#ffffff`, muted border `rgba(60,64,70,.12)`.
- Text: ink `#3a3f45`, secondary `#6b7280`, quiet `#9aa0a6`.
- Accent: ochre/gold `#a67c2e` / `#d4a24a`.
- Relations: direct gold `#d4a24a`, co-citation teal `#2bb39a`, coupling indigo `#6f7ee0`, weak gray `#7b8499`.
- Geometry: 8px controls, 10px shells, 12px/14px panel padding, 36px collapsed sheet header.
- Motion: lightweight state toggles; graph camera/layout transitions are handled by canvas code.

## Raw source

The complete stylesheet is [styles.css](../../styles.css). The main visual selectors are grouped as:

- pane shell and stage: `.cpo-root`, `.cpo-bar`, `.cpo-body`, `.cpo-stage`
- embed shell and stage: `.cpo-embed`, `.cpo-embed-bar`, `.cpo-embed-body`, `.cpo-embed-stage`
- shared controls: `.cpo-rail`, `.cpo-tools`, `.cpo-actions-bar`, `.cpo-sheet`, `.cpo-drawer`
- relation legend and semantic states: `.cpo-embed-legend`, `.cpo-drawer-legend`, `.cpo-badge-*`

No Tailwind, CSS modules, or external component library is used.
