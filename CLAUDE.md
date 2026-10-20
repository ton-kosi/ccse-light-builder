# CLAUDE.md

CCSE Light Builder — CCSE ERP v0 for a Bangkok architectural-lighting company.
Product scope and rules: @PRD.md · Look and feel: @DESIGN.md · Lovable rules
and domain notes: @AGENTS.md

## Always keep PRD.md up to date

Whenever a change adds, removes or alters a feature, screen, role,
permission, business rule, calculation or table:

1. Update the matching section of `PRD.md` (and its feature status ✅ 🟡 ⬜).
2. Add a row to the **Change log** (date `dd/mm/yyyy`, one line).
3. Update "Last updated" at the top.

Do this in the same piece of work as the code change, not later. If a
change affects colours, layout, components or printed documents, update
`DESIGN.md` too. Pure refactors with no behaviour change need no PRD entry.

## Commands

```bash
npm install        # install packages
npm run dev        # dev server on http://localhost:8080
npm run build      # production build
npm run lint       # eslint
npm run format     # prettier
npx -y bun@1.2.23 test   # unit tests (src/lib/*.test.js use bun:test; Bun isn't installed globally)
```

## Stack

React 19 · TanStack Start/Router/Query · Tailwind v4 · shadcn/ui · Vite 8 ·
Supabase (Postgres, Auth, Storage) via Lovable Cloud.

- `vite.config.ts` uses `@lovable.dev/vite-tanstack-config`, which already
  adds TanStack Start, React, Tailwind, tsconfig paths, Nitro, etc. Do not add
  those plugins again.
- `src/routeTree.gen.ts` is generated; do not edit.
- Files marked "automatically generated" in `src/integrations/supabase/` are
  managed by Lovable; do not edit.

## Layout

- `src/routes/` — file-based routes. `_authenticated/` = signed-in pages;
  `print.*` = A4 print/PDF views.
- `src/components/boq/` — BOQ grid, quotation footer, product builders
  (Linear, Neon, FoSet, Clipso, Film).
- `src/components/payments/`, `print/`, `work/`, `stock/`, `settings/`.
- `src/lib/` — pure business logic (`boq.ts`, `linear.ts`, `neon.ts`,
  `clipso.ts`, `film.ts`, `fo.ts`, `profiles.ts`, `billing.ts`…) with tests
  next to them. Put calculations here, not in components.
- `src/lib/erp.ts` — roles, project statuses, work-order statuses.
- `src/hooks/useMe.ts` — current user, roles and permission flags.
- `supabase/migrations/`, `drizzle/migrations/` — schema history.
  `docs/sql/` — SQL applied through Lovable.

## Rules

- **Prices and costs are never visible to `technician` or `production`.**
  Enforce it with RLS in the database, not only by hiding UI.
- Work orders may only be released at project status ≥ 6
  (`RELEASE_MIN_STATUS`).
- Every new table: enable RLS, grant only to `authenticated` and
  `service_role`, nothing to `anon`. Role checks go through `private.*`
  helpers (`has_role`, `has_any_role`, `can_see_money`,
  `can_manage_payments`, …).
- Ask the owner before any destructive schema change (drop/rename column or
  table, data deletion), and explain it first.
- UI text in Thai; code, tables and columns in English.
- Use `formatTHB`, `formatQty`, `formatDate` (`dd/mm/yyyy`) from
  `src/lib/format.ts`.
- Colours only via tokens in `src/styles.css` (oklch). See DESIGN.md.
- Never commit secrets (service role key, cron secret). The repo is
  **public**; the `.env` holds only the publishable key.
- The GitHub repo syncs with Lovable: never force-push or rewrite pushed
  history; keep `main` working.
- `supabaseAdmin` (service role, bypasses RLS) only inside server handlers
  after an explicit role check — see `src/lib/users.functions.ts`.
