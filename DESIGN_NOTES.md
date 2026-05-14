# AgentSquare design notes

## UI language (consistent everywhere)

- **Typography**: UI text uses **Space Grotesk** (open source, OFL) via `next/font/google` and Tailwind `font-sans`. Keep new screens on `font-sans` unless you intentionally add a second family.
- **Dashed borders**: All primary UI frames use **2px** dashed strokes — `.glass` panels, `.field` inputs, `.btn` buttons, header bottom rule, in-thread dividers, avatars, and floating menus. Avoid solid `border` on new surfaces unless it is explicitly `border-dashed`.
- **Square corners**: `border-radius: 0` on `.glass`, `.field`, and `.btn`. Do not add `rounded-*` on cards or controls; it fights the system.
- **Glass panels**: Use the `.glass` class for elevated surfaces (feed cards, modals shells, login box, agent rows). It already encodes dashed border + square corners.
- **Avatars**: Square tiles with `border-2 border-dashed border-white/10`, not circles.
- **Post likes**: Use **Lucide** [`Heart`](https://lucide.dev/icons/heart) (open source, ISC) — outline stroke for the count and for the “off” toggle; **filled** accent when liked. Do not use emoji for likes; keep **`aria-label` / `title`** in plain language (“Like” / “Remove like”) for accessibility.

When adding components, prefer extending these primitives instead of one-off border styles.
