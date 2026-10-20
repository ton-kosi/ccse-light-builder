# PRD — CCSE Light Builder (CCSE ERP v0)

> **Living document.** Update this file whenever a feature, rule, role, screen or
> data model changes, and add a line to the [Change log](#10-change-log).
> Last updated: 20/10/2026

## 1. Overview

**Company:** Chingchai & Sons Engineering (CCSE), Bangkok, plus its sister
company วรรณวิศวกรรม / One Engineering. Both sell and install specialist
architectural lighting:

- LED linear lighting (custom "Jedi" aluminium profiles)
- Jedi flex / neon flex
- Fibre-optic starry ceilings
- Clipso stretch ceilings
- Underwater lighting
- Smart film / privacy film (PDLC)

Most items are **custom assemblies**, not catalogue products.

**Problem:** quoting, material planning, purchasing, production and billing
are done across spreadsheets and paper. Prices leak to staff who should not
see them, materials are over- or under-ordered, and work starts before the
deposit is paid.

**Product:** a web ERP prototype (v0) that takes a project from enquiry to
closing in one place: BOQ and quotation → material demand → purchasing and
stock → work orders → installation → billing and receipts.

## 2. Goals and non-goals

### Goals (v0)
1. Sales and estimators build accurate quotations (BOQ) for custom lighting
   quickly, with product-specific calculators.
2. Every quotation line turns automatically into the real stock items (SKUs)
   needed, so purchasing and stock know what to buy and issue.
3. Production and technicians get work sheets **without any prices or costs**.
4. Work orders can only be released once the deposit is received or the CEO
   approves (project status ≥ 6).
5. Accounting issues billing documents per payment term, records receipts
   and sees what is due and overdue.

### Out of scope for v0
Payroll, HR, FlowAccount integration, technician calendar, forecasting,
mobile app.

## 3. Users and roles

| Role (`app_role`) | Thai label | Main jobs | Sees prices/costs |
|---|---|---|---|
| `admin` | ผู้ดูแลระบบ | Everything; users, settings, approvals | Yes |
| `sales` | ฝ่ายขาย | Customers, projects, quotations | Quote prices |
| `estimator` | ฝ่ายถอดแบบ/ประเมินราคา | BOQ, recipes, clauses, master data | Per policy |
| `stock` | ฝ่ายคลังสินค้า | SKUs, stock, purchase requests, purchases, remnants | Purchase costs |
| `production` | ฝ่ายผลิต | Work orders, cutting/roll plans | **No** |
| `accounting` | ฝ่ายบัญชี | Payment terms, billing, receipts | Yes |
| `technician` | ช่างติดตั้ง | Assigned work orders only | **No** |

- A user can hold several roles. A signed-in user with no role sees almost
  nothing ("ยังไม่กำหนดสิทธิ์").
- New users join **by admin invitation only** (no public sign-up).

## 4. Core concept — three layers

1. **Customer layer** — quotation lines (BOQ). Custom sales names the
   customer cannot compare elsewhere. Only lines with qty + unit show a price.
2. **Internal recipe layer** — `sales_components` + `recipes` (reusable) and
   `line_recipes` (one-off recipe for a single BOQ line).
3. **Stock layer** — `skus`, the real items issued from the warehouse.

Example: we **sell** "LED JEDI 13.8W/M" but **issue** SKU "LED strip 14.4W/m".

## 5. Project lifecycle

| Status | Thai label | Notes |
|---|---|---|
| 1 | ขอราคา | Enquiry |
| 2 | เก็บข้อมูล/ถอดแบบ | Survey / take-off |
| 3 | ทำ BOQ | Quotation in progress |
| 4 | ได้ PO | Customer PO received |
| 5 | รอมัดจำ | Waiting for deposit |
| 6 | ปล่อยใบ Work | **Work orders may be released from here** |
| 7 | ผลิต | Production |
| 8 | ติดตั้ง | Installation |
| 9 | ส่งมอบ | Handover |
| 10 | วางบิล | Billing |
| 11 | ปิดงาน | Closed |

- The project moves to 6 automatically when **all deposit terms (มัดจำ) are
  fully received**, or when the CEO/admin approves manually. Every status
  change is written to `project_status_log` with who and when.
- If the customer picked an option that is not yet selected in the project,
  the auto-move is blocked and the user is warned.

## 6. Features

Status: ✅ built · 🟡 partly built / in preview · ⬜ planned

### 6.1 Access and users
- ✅ Email + password sign-in; admin invites users by email (`/users`).
- ✅ Role-based menu and Row Level Security on every table.
- ✅ Sign-out clears all cached data.

### 6.2 Dashboard (`/dashboard`) ✅
- Overview per role. For accounting: **due to bill**, **overdue** (longest
  first, days in red) and the **latest 20 receipts**, each with THB totals.

### 6.3 Customers (`/customers`) ✅
- Customer master (code, name, contact, phone, email, address, tax ID).
- Technicians see customer names only, never contact details.

### 6.4 Projects (`/projects`, `/projects/$projectId`) ✅
Tabs: **ภาพรวม** (overview) · **BOQ** · **ใบ Work** · **งวดเงิน** (payments).

#### BOQ / quotation
- ✅ Grid editor; columns size themselves to the longest visible text.
- ✅ Zones (bold headings), multi-line descriptions, circuit numbers, cut
  lengths printed as dash-prefixed metre lines.
- ✅ Line kinds, including `internal` (work-sheet note only: never printed,
  no price, not in material demand).
- ✅ Options; totals shown per option.
- ✅ Revisions (Rev): first revision "A" is hidden on print; later ones show.
  Creating a Rev copies lines, clauses, payment terms, billings and receipts.
- ✅ Totals: subtotal → special discount → contract adjustments (% on the
  running total, fixed amount, or note) → VAT. `vat_mode` only changes how VAT
  is printed (show / "EXCLUDING VAT x%" / none).
- ✅ Quotation footer: remarks & warranty clauses, closing text, signer,
  TERM OF PAYMENT, VALIDITY, DELIVERY, APPROVED BY.
- ✅ Issuing company per quotation (`ccse` or `one`).
- ✅ Print preview and PDF share one A4 view (`/print/quotation/$id`); the
  footer never breaks across pages.

#### Product calculators (builders)
- ✅ **LED linear** — profile rules (Jedi % per LED/profile, sizes by
  mounting/trim, 3/8 vs 4/8 rail, PCB > 10 mm not allowed in W13/45° Reverse).
- ✅ **Jedi flex / neon** — sold by the roll: runs packed into 5/10 m rolls
  (no joining offcuts); all lines of one roll family share one price per metre.
- ✅ **Fibre-optic sets**.
- ✅ **Clipso stretch ceiling** — 3.4/5.1 m × 50 m rolls, +10 cm per side,
  strips across the roll width, track in 2 m lengths, optional LED above.
- ✅ **Privacy film (PDLC)** — per m² on cutting size, max sheet 1.5 × 3 m,
  busbar per piece, transformers per location by watts.
- Builders only offer SKUs of the matching stock category.

#### Work tab (ใบ Work)
- ✅ Work sheet without prices; roll/cutting plan for roll products.

#### Payments tab (งวดเงิน) — admin and accounting only
- ✅ Payment terms (%, fixed amount, trigger condition, printed text).
- ✅ Issue billing document ("ออกใบเบิกเงิน") → A4 "INVOICE PAYMENT" with RC
  number, summary of earlier bills, ex-VAT → VAT → withholding tax → THIS TIME
  PAYMENT, amount in Thai words, bank account.
- ✅ Record receipts: several per term (transfer / cheque / cash, bank ref,
  withholding tax, slip upload, note).
- ✅ Term statuses: ยังไม่ถึง / ถึงเวลาวางบิล / วางบิลแล้ว / เกินกำหนด (X วัน)
  / รับบางส่วน / รับครบ.
- ✅ Cancel a bill or void a receipt: admin only, reason required, kept on
  record.
- ✅ Audit log of every billing / receipt action.

### 6.5 Stock and master data
- ✅ **SKUs** (`/skus`) — categories and per-category attributes (LED W/m, chip,
  PCB width, profile model, rail size, PSU watt/dim) stored as tags in notes.
- ✅ **Stock** (`/stock`) — on-hand by category.
- ✅ **Remnants** (`/remnants`, เศษม้วน) — roll leftovers that can be reused.
- ✅ **Clauses** (`/clauses`) — remark / warranty / note / warning text,
  linked to sales components or "every quotation".
- ✅ CSV import for master data.
- ✅ **Stock count by CSV** (admin, estimator, stock): the SKU import accepts an
  optional `qty` column = counted stock. The difference from the current on-hand
  is posted as an `adjust` movement ("ตรวจนับสต็อก (นำเข้า CSV)"), so importing
  the same file twice does not double the stock. Blank `qty` = not counted.

### 6.6 Purchasing
- ✅ **Purchase requests** (`/purchase-requests`) — from material demand.
- ✅ **Purchases** (`/purchases`) — each purchase receives stock and updates
  the SKU cost to the latest purchase cost (price + extra cost ÷ qty).
- 🟡 **Edit a purchase** (admin only): fix qty, price, extra cost, date,
  supplier, bill no., project, note or SKU. The stock difference is posted as
  an adjustment and the SKU cost is recalculated. A purchase received from a
  purchase request keeps its SKU. Needs `docs/sql/purchases_edit.sql` applied.
- ✅ Delete a purchase (admin only): stock taken back out, cost recalculated.

### 6.7 Work orders (`/work-orders`) ✅
- Types: production, installation, service. Statuses: draft → released →
  in progress → done / cancelled.
- Release blocked until project status ≥ 6. No prices anywhere.

### 6.8 Settings (`/settings`) ✅
- Issuing companies: letterhead, tax ID, bank, bill signer, default
  withholding tax, logo.

## 7. Business rules (non-negotiable)

1. Technicians and production staff must **never** see prices or costs —
   enforced in the database (RLS), not only in the UI.
2. A work order may only be released when project status ≥ 6.
3. Row Level Security on every table; no access for signed-out visitors.
4. Any destructive schema change is explained and approved by the owner first.
5. All UI text in Thai; code, tables and columns in English.
6. Dates `dd/mm/yyyy`; currency THB with thousands separators, 2 decimals.
7. Keep it simple: clear tables and forms over fancy UI.

## 8. Technical summary

- **Front end:** React 19, TanStack Start + Router + Query, Tailwind v4,
  shadcn/ui (Radix), Vite 8. Built and synced with Lovable.
- **Back end:** Supabase (Postgres + Auth + Storage) via Lovable Cloud; RLS
  policies and `SECURITY DEFINER` helpers in the `private` schema.
- **Hosting:** Lovable (Cloudflare target via Nitro).
- **Source:** GitHub `ton-kosi/ccse-light-builder` (public), branch `main`.
  Lovable commits to it; pushes to `main` sync back into Lovable.

## 9. Open questions / backlog

- ⬜ Restrict `user_roles` and `recipe_items` reads to users who have a role.
- ⬜ Turn off public sign-ups in Supabase Auth (invite-only is intended).
- ⬜ Confirm whether payment-term amounts are before VAT (current assumption)
  or VAT-inclusive.
- ⬜ Technician calendar, FlowAccount integration (post-v0).

## 10. Change log

| Date | Change |
|---|---|
| 20/10/2026 | SKU CSV import: optional `qty` column sets counted stock (opening stock / stock take). All test data to be wiped with a one-time reset before real stock is entered. |
| 20/10/2026 | Purchases: admin can edit a recorded purchase (stock and cost follow). DB migration `0009_purchases_edit` pending in Lovable. |
| 18/10/2026 | PRD created from the current codebase (state as of GitHub `main`, last push 17/10/2026). |
