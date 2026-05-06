---
date: 2026-05-06T00:00:00Z
topic: "Design-system migration backlog (open items vs. brand kit)"
status: open
author: Claude (phase 11)
related_audit: thoughts/taras/research/2026-05-06-design-system-audit.md
related_plan: thoughts/taras/plans/2026-05-06-new-ui-design-system-migration.md
---

# Design-system migration — open backlog

The 2026-05-06 new-ui design-system migration deliberately did not adopt every brand-kit construct. This file is the consolidated, action-oriented backlog future plans can pick up. Each item: 1-line description, 1-line rationale, 1-line "when to revisit".

Source of detail: [`2026-05-06-design-system-audit.md` § Phase 11](./2026-05-06-design-system-audit.md#phase-11--closing-open-backlog-vs-brand-kit).

---

## Tokens

### 1. Spacing scale — `--space-{1,2,3,4,5,6,8,10,12,16,20,24,32}`
- **What**: Adopt brand-kit's explicit `--space-*` token surface in `new-ui/src/styles/globals.css`.
- **Why deferred**: new-ui uses Tailwind's default `p-*`/`gap-*` scale. Adopting tokens would touch every page (largest possible refactor) for marginal codification benefit; values are byte-equivalent.
- **When to revisit**: When unifying spacing across `landing/` + `new-ui/` + `templates-ui/` and explicit token surface becomes load-bearing for cross-surface consistency.

### 2. Type scale — `--t-display`, `--t-h1..h4`, `--t-body{,-lg,-sm}`, `--t-caption`, `--t-tag`
- **What**: Adopt brand-kit's type-scale tokens.
- **Why deferred**: Tailwind text utilities cover existing usage. Concrete signal: `--t-tag: 0.5625rem` (= 9px) is byte-equivalent to inline `text-[9px]` in `Badge size="tag"`.
- **When to revisit**: If type hierarchy needs cross-surface alignment, or `text-[9px]` arbitrary utility gets flagged as worth tokenising.

### 3. Line-height scale — `--lh-tight`, `--lh-snug`, `--lh-body`, `--lh-loose`
- **What**: Adopt brand-kit's line-height tokens.
- **Why deferred**: Tailwind's `leading-*` utilities cover existing usage.
- **When to revisit**: Pair with type-scale adoption; not standalone.

### 4. Shadow scale — `--shadow-{xs,sm,md,lg,xl}` + `--shadow-amber-glow`
- **What**: Adopt brand-kit's shadow tokens.
- **Why deferred**: Tailwind `shadow-*` covers dashboard usage. Amber-glow is a landing-CTA construct.
- **When to revisit**: If a marketing-style CTA lands in the dashboard (paid-tier upsell). Adopt `--shadow-amber-glow` as a one-off rather than the full scale.

### 5. Text-color shorthands — `--fg-1`, `--fg-2`, `--fg-3`, `--fg-4`
- **What**: Adopt brand-kit's four-tier text-color shorthand.
- **Why deferred**: new-ui uses two-tier `text-foreground` / `text-muted-foreground`. Four tiers are denser than current needs.
- **When to revisit**: If documentation or marketing surfaces in new-ui need finer-grained text hierarchy.

### 6. Eyebrow tokens — `--eyebrow-color`, `--eyebrow-tracking`, `.t-eyebrow`
- **What**: Adopt brand-kit's eyebrow construct.
- **Why deferred**: Landing-only construct; new-ui has no eyebrow pattern.
- **When to revisit**: Only with a marketing surface in new-ui.

### 7. Extra radii — `--radius-2xl` (1rem), `--radius-full` (9999px)
- **What**: Adopt brand-kit's two extra radius tokens.
- **Why deferred**: `radius-full` is byte-equivalent to Tailwind's `rounded-full`. No new-ui surface needs `radius-2xl` semantically today.
- **When to revisit**: Add ad-hoc when a primitive needs `rounded-2xl` semantically (rather than as a one-off Tailwind utility).

### 8. Raw palette scales — `--amber-{50..900}`, `--zinc-{50..950}`
- **What**: Re-emit raw Tailwind scales as CSS variables.
- **Why deferred**: Brand kit needs them for landing hero compositions; new-ui consumes the palette via Tailwind utility classes (now lint-gated). Tailwind v4 already provides `--color-*` defaults.
- **When to revisit**: Only if cross-surface code references scales by CSS variable rather than Tailwind class. Unlikely.

### 9. Font-fallback alignment
- **What**: Update `--font-sans` fallback to match brand kit (`"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif`).
- **Why deferred**: Functionally equivalent — both load Space Grotesk; brand kit's chain is more conservative for missing-font edge cases. Not visible in practice.
- **When to revisit**: Trivial; fold into any future `globals.css` cleanup.

## Helper classes

### 10. `.gradient-text`
- **What**: Adopt brand kit's gradient-text helper from `colors_and_type.css:261`.
- **Why deferred**: Zero matches in `new-ui/src/`; landing hero construct.
- **When to revisit**: When a marketing-style hero lands in new-ui.

### 11. `.grid-bg`
- **What**: Adopt brand kit's grid-background helper from `colors_and_type.css:282`.
- **Why deferred**: Zero matches in `new-ui/src/`; landing hero construct.
- **When to revisit**: Same as `.gradient-text` — only with a hero surface.

## Architectural

### 12. Multi-surface package extraction
- **What**: Extract a shared `packages/swarm-design-system/` consumed by `new-ui/`, `landing/`, `templates-ui/`, `docs-site/`.
- **Why deferred**: Out of scope; current plan locks `new-ui/` as the canonical implementation.
- **When to revisit**: When the second surface (`landing/` or `templates-ui/`) starts pulling tokens or primitives from `new-ui/` and copy-paste becomes painful.

### 13. Storybook / dedicated `/design-system` route
- **What**: Build a primitive-showcase route or Storybook instance.
- **Why deferred**: 33 existing routes serve as the live catalog; CLAUDE.md primitives table is the doc surface.
- **When to revisit**: If primitive count grows past ~50 and the inline catalog becomes hard to navigate, or if external designers need a non-coding entry point.

### 14. Utility count soft floor
- **What**: Reach 20+ utilities/hooks in `src/lib/` + `src/hooks/`.
- **Why deferred**: Current count is **18**. The plan explicitly says do not invent utilities to hit the number. Phase 10 only extracted on actual duplication (net +11 from baseline).
- **When to revisit**: As real duplication surfaces in future feature work, not as a standalone task.

### 15. Project-root `CLAUDE.md` correction
- **What**: Fix "Dashboard (Next.js, port 5274)" — new-ui is React + Vite, not Next.js.
- **Why deferred**: Out of scope of the design-system plan; needs a separate doc PR.
- **When to revisit**: Next time anyone touches `CLAUDE.md` at project root.

---

## Out of scope (closed, not backlog)

- **Brand-kit overwrite.** `~/Downloads/swarm-design-system/` stays read-only.
- **`new-ui/` style switch away from Tailwind v4 / shadcn.** Foundation stays.
- **`next-themes` re-introduction.** Removed in Phase 6; the custom `useTheme` hook is canonical.
