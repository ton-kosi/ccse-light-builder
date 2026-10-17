# DESIGN — CCSE Light Builder

How the app looks and behaves. The source of truth for colours is
`src/styles.css`; for components, `src/components/ui` (shadcn/ui, "new-york"
style, slate base, lucide icons). Update this file when the design system
changes.

## 1. Principles

1. **Clear tables and forms over fancy UI.** Users are office and warehouse
   staff working fast on desktop; density beats decoration.
2. **Thai first.** Every label, button, message and empty state is in Thai.
   English appears only where the printed document is in English (e.g.
   "TERM OF PAYMENT", "INVOICE PAYMENT").
3. **Money is invisible by default.** A screen must look complete and make
   sense for a technician who cannot see prices, not just hide a column and
   leave a gap.
4. **Print is a first-class output.** Quotations, bills, work sheets and
   remnant labels are printed or saved as PDF, and must match the paper
   documents customers already know.

## 2. Colour tokens

All colours are **oklch** custom properties on `:root` (light) and `.dark`,
registered in `@theme inline` as Tailwind utilities (`bg-primary`,
`text-muted-foreground`…). Never hard-code hex/rgb in components.

| Token | Light | Use |
|---|---|---|
| `background` | `oklch(0.985 0.004 95)` warm off-white | Page background |
| `foreground` | `oklch(0.24 0.03 250)` deep slate blue | Body text |
| `card` / `popover` | white | Panels, dialogs, header bar |
| `primary` | `oklch(0.38 0.09 252)` CCSE navy | Main buttons, brand "CCSE", active nav |
| `secondary` / `muted` | `oklch(0.955 0.008 250)` | Subtle fills, sign-in background |
| `muted-foreground` | `oklch(0.52 0.03 252)` | Hints, descriptions, secondary text |
| `accent` | `oklch(0.93 0.05 80)` soft amber | Highlights, hover |
| `success` | `oklch(0.55 0.13 150)` green | รับครบ, done |
| `warning` | `oklch(0.72 0.15 70)` amber | ถึงเวลาวางบิล, needs attention |
| `destructive` | `oklch(0.55 0.2 27)` red | เกินกำหนด, delete, errors |
| `by-buyer` | `oklch(0.45 0.08 55)` brown | Items supplied by the customer/buyer |
| `border` / `input` / `ring` | light slate | Lines, field borders, focus ring |
| `chart-1…5` | — | Dashboard charts only |

**Adding a colour:** add the variable to `:root` and `.dark`, then register
`--color-<name>: var(--<name>)` in `@theme inline`.

Status colours are always paired with text (e.g. "เกินกำหนด 12 วัน"), never
colour alone.

## 3. Typography

- Font: **Noto Sans Thai** (Google Fonts, weights 400/500/600/700), fallback
  `system-ui`. Loaded in `src/routes/__root.tsx`.
- Page title: `text-xl font-semibold tracking-tight` (via `PageHeader`).
- Description under a title: `text-sm text-muted-foreground`.
- Body and tables: `text-sm`. Small meta: `text-xs`.
- Tables use `tabular-nums` globally so numbers line up.

## 4. Formatting

Always use the helpers in `src/lib/format.ts`:

| Data | Helper | Example |
|---|---|---|
| Money (THB) | `formatTHB` | `12,345.00` |
| Quantity | `formatQty` | `1,234.5` (max 3 decimals) |
| Date | `formatDate` | `18/10/2026` |
| Parse user input | `toNumber` | accepts `1,234.50` |
| Baht in words | `bahtText` (`src/lib/bahtText.ts`) | หนึ่งหมื่นบาทถ้วน |

Empty or missing values show `-`. Numbers are right-aligned in tables.

## 5. Layout

- **App shell** (`src/components/AppLayout.tsx`): collapsible icon sidebar on
  the left, 56 px header bar (`h-14`, `bg-card`, bottom border) with the user's
  name, roles and a sign-out button.
- Content area: `max-w-7xl`, `px-4 py-6`, centred.
- **Sidebar:** brand "CCSE" in `text-primary` + "ERP v0". Menu items are
  filtered by role (see `NAV`); never show a link the user cannot open.
- **Page header** (`PageHeader`): title + optional description on the left,
  action buttons on the right; wraps on narrow screens.
- **Project page:** tabs — ภาพรวม · BOQ · ใบ Work · งวดเงิน. The payments tab
  only exists for admin/accounting.
- Responsive enough for a tablet; v0 does not target phones.

## 6. Components

Use the shadcn/ui primitives in `src/components/ui` before writing new ones.

- **Buttons:** `default` (primary navy) for the main action of a screen, one
  per area; `outline` for secondary; `destructive` only for delete/void;
  `ghost` for icon buttons in tables. Button text is a Thai verb
  ("บันทึก", "ออกใบเบิกเงิน", "พิมพ์").
- **Dialogs** for create/edit forms and builders (Linear, Neon, FO set,
  Clipso, Film). Destructive actions use `AlertDialog` and, where history
  matters, require a reason.
- **Tables:** plain `Table`, compact rows, sticky header for long lists,
  totals row at the bottom in `font-semibold`.
- **BOQ grid** (`src/components/boq/BoqGrid.tsx`): a fixed `colgroup` where
  each column is measured from its longest visible content (controls, labels,
  text, buttons, using rendered fonts) and remeasured on input. Do not cap
  input lengths.
- **Badges** for statuses (project, work order, payment term).
- **Toasts** (`sonner`) for success/error feedback, in Thai.
- **Forms:** label above field (`Label` + `Input`), `space-y-1.5` within a
  field, `space-y-4` between fields.
- **Icons:** lucide-react, `h-4 w-4` inline with text.

## 7. Printed documents

Routes under `/print/...` render A4 pages used for both preview and PDF
(`html2canvas-pro` + `jspdf`, see `src/lib/pdf.ts`).

- **Letterhead** (`DocHeader`): company logo left (max 22 mm high), Thai and
  English company names + tax ID right-aligned, 2 px bottom rule, document
  title below.
- **Footer** (`DocFooter`): address/contact lines, 9 px, centred, top rule.
- **Quotation:** zones in bold above descriptions; cut lengths as
  dash-prefixed metre lines; first revision label "A" hidden; description
  lines fit their measured column width while keeping manual line breaks.
  Totals → REMARK / WARRANTY / หมายเหตุ / WARNING → closing sentence →
  two columns (signer left; TERM OF PAYMENT, VALIDITY, DELIVERY, APPROVED BY
  right). The footer block never splits across pages.
- **Billing ("INVOICE PAYMENT")** (`BillingSheet.tsx`): same letterhead,
  amount in Thai words, bank account, signature block.
- **Work sheet:** no prices, no costs, ever.
- **Remnant labels:** 80 × 50 mm.
- The preview and the PDF must use the same component so they never differ.

## 8. Dark mode

Tokens exist for `.dark`, but v0 is designed and tested in light mode.
Printed documents are always black on white.
