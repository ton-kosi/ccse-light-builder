# PRD — CCSE Light Builder (CCSE ERP v0)

> **Living document.** Update this file whenever a feature, rule, role, screen or
> data model changes, and add a line to the [Change log](#10-change-log).
> Last updated: 24/10/2026

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
Payroll, HR, FlowAccount integration, forecasting, native mobile app
(technician pages must still work in a phone browser). The technician /
production queue is now **in scope** (workflow step 5–7).

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

## 5b. Target workflow (owner, 22/10/2026) and gaps

The owner's end-to-end workflow. Status: ✅ in the app · 🟡 partly · ⬜ missing.

| # | Step | Today | Gap to close | Phase |
|---|---|---|---|---|
| 1 | Input SKU | ✅ SKU form, CSV import, LED neon flex / LED เส้น cut step | — | — |
| 2 | Stock / buy in | ✅ purchase requests, purchases (receive + cost), stock count CSV, remnants | — | — |
| 3 | BOQ quotation | ✅ builders (linear, neon, FO, Clipso, film), options, Rev, clauses, print/PDF | Warranty period as a number (see 11) | C |
| 4 | Request payment; PO → reserve stock/purchase; deposit → lock + ใบ Work for เบิกของ | ✅ payment terms + ใบเบิกเงิน; stock **จอง** at status 4–5, **ล็อก** at 6; deposit fully received → status 6 → work orders released, pick list, material issue | — | — |
| 5 | Queue technicians to **measure on site**; production writes **cut / assembly lengths** on the production sheet | 🟡 Phase A ✅ (queue, survey jobs) + Phase B built: measured lengths per line, production list uses them. Not yet: LED strip cut-step rounding | Site-survey job type; assign technicians; queue view; record **measured length per BOQ line**; production sheet uses measured lengths + LED strip cut step + neon roll plan | A, B |
| 6 | **Revise BOQ** from measured / actually produced lengths → final billing term | 🟡 Phase B built: final Rev from measurements, contract vs measured, balance term | "Final Rev from measurements" (pre-filled from measured lengths, shows +/- vs. contract); last term = final total − already billed | B |
| 7 | Installation info for technicians: install queue, production queue, drawings; install days must not exceed the quotation, otherwise charge extra | ✅ Phase A: queue, drawings/photos on jobs, actual days set at handover → overrun × rate | Install and production **calendar/queue**; attach **drawings (แบบ)** and files to project/work order; actual days counted from install start → handover; overrun shown as a billable extra | A |
| 8 | Handover: photos + delivery note signed by the customer | ✅ Phase A (handover + printed ใบส่งมอบงาน) | Handover record per work order: photos, printable **ใบส่งมอบงาน**, customer signature (on screen or signed scan), handover date → status 9 | A |
| 9 | Bill several times during the job (e.g. material on site before 100%) | ✅ triggers: deposit, before delivery, material on site, after delivery, substantial completion, progress | Auto-flag "ถึงเวลาวางบิล" from handover / material-on-site events | A |
| 10 | Chase payment (ทวงเงิน) | 🟡 dashboard lists overdue terms by days | Follow-up log per bill (date, who, note, next follow-up), "ต้องทวงวันนี้" list, printable reminder letter | D |
| 11 | Repairs: check warranty from the quotation; in warranty → repair ticket + technician/production queue; out of warranty → new quotation (step 3) | 🟡 work-order type บริการ/ซ่อม exists; warranty is free text only | Warranty months per quotation (and per line if needed); warranty end = handover date + months; **ใบแจ้งซ่อม** with automatic in/out-of-warranty check; in → service work order in the queue (+ production if needed); out → new quotation linked to the original project | C |

### Delivery phases (proposed order)

- **Phase A — Field work & handover (steps 5, 7, 8, 9):** job types incl. วัดหน้างาน; assign one or more technicians; technician + production queue (by day/week); files on project & work order (drawings, site photos); handover with photos + signed delivery note; handover date drives actual install days, overrun charge, billing triggers and warranty start. Technicians see their own jobs, drawings and addresses — never prices.
- **Phase B — Measure → produce → final BOQ (steps 5, 6):** measured length per BOQ line on the survey job; production sheet from measured lengths (LED strip cut step, neon roll plan, remnants); "final Rev" from measurements with +/- vs. contract; final term = final total − billed.
- **Phase C — Warranty & repair (steps 3, 11):** warranty months on quotations; repair ticket with warranty check; in-warranty → service work order in the queue; out-of-warranty → new quotation.
- **Phase D — Collections (step 10):** follow-up log, due-today list, reminder letter.

Open questions for the owner:
- Customer signature: sign on a phone/tablet screen, or upload a photo of the signed paper?
- Do technicians each have their own login (phone), or does one supervisor update jobs?
- Final Rev: always bill the measured quantity, or only when it differs from the contract by more than a set %?
- Install overrun: count calendar days or working days? Who approves the extra charge?

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
- ✅ **Delete project** (admin): type the project code to confirm; removes
  quotations, work orders, payments and bills (database cascade) and then its
  stored files — drawings, photos, signatures, payment slips, bill PDFs.
Tabs: **ภาพรวม** (overview) · **BOQ** · **ใบ Work** · **งวดเงิน** (payments).

#### BOQ / quotation
- ✅ Grid editor; columns size themselves to the longest visible text.
- ✅ Zones (bold headings), multi-line descriptions, circuit numbers, cut
  lengths printed as dash-prefixed metre lines.
- ✅ Line kinds, including `internal` (work-sheet note only: never printed,
  no price, not in material demand).
- ✅ Options; totals shown per option.
- ✅ Revisions (Rev): first revision "A" is hidden on print; later ones show.
  Creating a Rev copies lines, clauses, payment terms, billings, receipts and
  site measurements.
- 🟡 **Final Rev from measurements** (BOQ tab, quote editors): contract vs
  measured per line with the +/- money before and after VAT; one button creates
  a new Rev whose quantities and cut lengths are the measured ones, and marks the
  last payment term as the balance.
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
- 🟡 **วัดหน้างาน (site measurement):** on survey jobs and on the ใบ Work tab,
  every work line of the current quotation gets the measured cut lengths
  ("4.2+6.5", metres), the measured quantity (summed from the cut lengths for
  metre units) and a note. No prices; all staff can enter it. A new Rev carries
  the measurements over.
- 🟡 The production list shows the **measured** cut lengths / quantity in bold
  with "วัดจริง" (and the contract quantity when it differs) until the final
  Rev takes them in.

#### Payments tab (งวดเงิน) — admin and accounting only
- ✅ Payment terms (%, fixed amount, trigger condition, printed text).
- 🟡 **Balance term (ยอดคงเหลือ):** one term per quotation can bill "total −
  every other term" (billed terms count at their billed amount), so the final
  bill after a re-measure closes the job exactly. The bill text says
  "(BALANCE)".
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
- ✅ **SKU types:** tick **LED neon flex** (sold by 5/10 m roll: roll family, cut
  step, max piece) or **LED เส้น** (LED strip cut on site: cut step in cm only).
  Stored in `cut_step_cm`; an LED strip is a non-roll SKU with a cut step. In CSV: leave `is_roll` empty and fill
  `cut_step_cm`. ⬜ Next: use the LED strip cut step on the ใบ Work /
  production sheet.
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
- ✅ **Edit a purchase** (admin only): fix qty, price, extra cost, date,
  supplier, bill no., project, note or SKU. The stock difference is posted as
  an adjustment and the SKU cost is recalculated. A purchase received from a
  purchase request keeps its SKU.
- ✅ Delete a purchase (admin only): stock taken back out, cost recalculated.

### 6.7 Work orders (`/work-orders`) ✅
- Types: **วัดหน้างาน (survey)**, production, installation, service. Statuses:
  draft → released → in progress → done / cancelled.
- ✅ **Plan** (admin, sales, production): start date, end date for multi-day
  jobs, and the people assigned (technicians / production).
- ✅ **Files:** drawings (แบบ) on the project — shown on every work order —
  or on one job; site photos. Private storage, images and PDF up to 20 MB;
  upload from a phone camera. Uploader or admin can delete.
- ✅ **Handover (ส่งมอบงาน)** on survey / installation / service jobs once
  released: photos of the finished work (required), receiver name and
  position, date, note, and the customer's signature on screen **or** a photo
  of the signed paper. Saving closes the job (done). For the last open
  installation job it also sets actual install days (handover − install
  start + 1, calendar days) and moves the project from 6–8 to **9 ส่งมอบ**,
  which makes "งานแล้วเสร็จ" payment terms due.
- ✅ **ใบส่งมอบงาน / DELIVERY NOTE** (`/print/handover/$woId`): letterhead,
  customer, project, site, job, items, up to 6 photos, customer signature and
  crew; print or PDF. No prices.

### 6.7b Job queue (`/queue`, คิวงาน) ✅
- Week view (Mon–Sun) of all jobs that are not cancelled; multi-day jobs show
  on every day; jobs without a date are listed separately.
- Filter by job type and person, or "งานของฉัน" (my jobs); technicians and
  production staff open on their own jobs. Done jobs hidden unless ticked.
- Each card: type colour, job no., project, site address, people, status.

Tested end to end on 24/10/2026 (assign, uploads, queue, handover with signature, project 6 → 9, actual install days, delivery note print/PDF).
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
- ⬜ FlowAccount integration (post-v0).
- ⬜ Workflow phases C–D (section 5b). Phase B migration `0013_measure_final_rev` is applied; the measurement → final Rev → balance-billing UI flow still needs end-to-end verification.
- ⬜ Final Rev: line recipes with fixed quantities (custom builder blocks) are copied as they are — re-open the builder if a measured length changes material, e.g. LED strip or profile pieces.

## 10. Change log

| Date | Change |
|---|---|
| 24/10/2026 | Applied the existing migrations `0012_cleanup_probe_and_files` and `0013_measure_final_rev` in journal order without changing their SQL or app logic; verified the storage delete policy, measurement table/RLS, balance flag/index, revision functions, regenerated types, build, and 14 existing measurement/payment tests. |
| 24/10/2026 | **Phase B — measure → final Rev → final bill:** site measurements per BOQ line (survey job + ใบ Work tab), production list shows measured lengths, final Rev from measurements with contract vs measured, balance payment term. Migration `0013_measure_final_rev` applied; full UI flow not yet verified. |
| 24/10/2026 | Admin **delete project** removes its stored files too. Migration `0012_cleanup_probe_and_files` lets admin delete payment slips / bill PDFs (Lovable's probe tables were already gone, so the drop was removed — Lovable blocks dropping tables). |
| 24/10/2026 | Migrations 0009 + 0010 applied by Lovable; Phase A and purchase edit tested end to end. Thumbnails retry once after a failed first load; signature blends into the delivery note. |
| 22/10/2026 | **Phase A — field work & handover:** survey job type, multi-day jobs, assigned people, job queue (คิวงาน), drawings/photos on projects and jobs, handover with photos + signature, printed ใบส่งมอบงาน; handover closes the job, sets actual install days and moves the project to 9. Migration `0010_field_work_handover` pending in Lovable. |
| 22/10/2026 | Added the owner's 11-step target workflow with a gap analysis and delivery phases A–D (section 5b); technician queue moved into scope. |
| 20/10/2026 | SKU: new **LED เส้น** option with cut step (ซม.) only (reel length removed at owner request); "เป็นสินค้าม้วน" renamed **LED neon flex**. |
| 20/10/2026 | SKU CSV import: optional `qty` column sets counted stock (opening stock / stock take). All test data to be wiped with a one-time reset before real stock is entered. |
| 20/10/2026 | Purchases: admin can edit a recorded purchase (stock and cost follow). DB migration `0009_purchases_edit` pending in Lovable. |
| 18/10/2026 | PRD created from the current codebase (state as of GitHub `main`, last push 17/10/2026). |
