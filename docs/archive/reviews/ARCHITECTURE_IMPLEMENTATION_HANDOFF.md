# Architecture Improvement Handoff

## Owner
Desktop App Engineer (recommended assignee)

## Source
`ARCHITECTURE_REVIEW.md`, especially recommendations 1 and 4.

## Objective
Introduce a lightweight architecture safety net without a broad rewrite of the Obsidian plugin.

## Scope
1. Add a deterministic offline verification for dependency direction:
   - domain/semantic modules must not import Obsidian, DOM, or HTTP adapters;
   - source/persistence adapters must not import UI modules;
   - UI entrypoints may depend on domain modules and adapters.
2. Extend existing verification scripts rather than adding a new test framework.
3. Add focused deterministic checks for the highest-risk boundaries identified in the report:
   - citation direction and missing/conflicting source evidence;
   - sampling/range boundaries;
   - settings merge and edge values;
   - stale async response protection, where an existing seam permits a regression check.
4. Keep the current modular-monolith deployment shape. Do not introduce microservices or a full DI/container layer.

## Acceptance criteria
- `npm test` passes.
- The new checks fail with a clear message if a forbidden dependency is introduced.
- Existing behavior remains unchanged outside verification coverage.
- The implementation is small, documented, and limited to the identified boundaries.
- Report changed files and any residual gaps in the child issue.

## Non-goals
- Splitting `app.ts`, `graph-3d.ts`, or `map-canvas.ts` wholesale.
- Replacing the existing build/test setup.
- Runtime fault-injection or full Obsidian-version compatibility testing.
