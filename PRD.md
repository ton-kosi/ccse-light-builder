# PRD — CCSE Light Builder (CCSE ERP v0)

> **Living document.** Update this file whenever a feature, rule, role, screen or
> data model changes, and add a line to the [Change log](#10-change-log).
> Last updated: 26/10/2026

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

Teams (owner, 26/10/2026) map onto the roles:

| Team | Role (`app_role`) | Main jobs | Selling prices (BOQ) | Costs / suppliers |
|---|---|---|---|---|
| Admin | `admin` | Everything; users, settings, approvals | Yes | Yes |
| ทีมขาย (sale) | `sales`, `estimator` | Customers, projects, BOQ, payment terms in the quote, WOS, schedule / queue, repairs, site measurements; **sees bills and money received (read only)** | Yes (edit) | **No** — sees stock quantities only |
| ทีมจัดซื้อ (purchase) | `stock` | SKUs, stock, purchase requests, purchases of **local** SKUs, remnants, material issue / return | **No** | **Local SKUs only** (latest cost, purchase history); imported SKUs are bought and costed by admin |
| ทีมการเงิน (payment) | `accounting` | Payment terms, bills, receipts, ทวงเงิน; reads the BOQ | Yes (read only) | **No** |
| ทีมผลิต (production) | `production` | Production sheet (ใบผลิต), production jobs, project status, stock / remnants view | **No** | **No** |
| ช่าง | `technician` | Own schedule, work orders + WOS, repairs (view), measurements, handover, site photos | **No** | **No** |

- **Margin stays with admin:** nobody else can see a cost next to a selling price — the sale and
  payment teams see selling prices but no costs; the purchase team sees local costs but no selling
  prices. BOQ cost / margin columns and typing costs or selling prices by hand: admin only.
- SKU **แหล่งที่มา (ในประเทศ / นำเข้า)** decides who sees its cost; only admin can change it.
- Technicians have no project list, customer list, stock or purchase pages; a work order links
  to its WOS instead of the project page.
- Enforced in the database (RLS, migrations `0024_team_access` and `0025_cost_privacy`) as well as in the menus.

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
  fully received**, or when the CEO/admin approves manually. It moves to 7 when the
  store confirms the first material issue, to **8 when an installation job is set to
  "กำลังทำ"** (so "ของถึงหน้างาน" / "หลังส่งของ" terms become due — migration 0022 applied and verified on 26/10/2026; only moves 6–7 → 8), and
  to 9 at the last installation handover. Every status
  change is written to `project_status_log` with who and when.
- The payment team (accounting) can move a project 9 → **10 วางบิล** and 9 / 10 → **11 ปิดงาน**
  from the งวดเงิน tab; closing needs nothing left to collect (migration 0026). They cannot
  change any other project field.
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
| 5 | Queue technicians to **measure on site**; production writes **cut / assembly lengths** on the production sheet | ✅ Phase A + B + production sheet: measured lengths per line (length × sets), cut-step rounding, stickers, issue rounds / returns | Site-survey job type; assign technicians; queue view; record **measured length per BOQ line**; production sheet uses measured lengths + LED strip cut step + neon roll plan | A, B |
| 6 | **Revise BOQ** from measured / actually produced lengths → final billing term | ✅ Phase B: final Rev from measurements, contract vs measured, balance term | "Final Rev from measurements" (pre-filled from measured lengths, shows +/- vs. contract); last term = final total − already billed | B |
| 7 | Installation info for technicians: install queue, production queue, drawings; install days must not exceed the quotation, otherwise charge extra | ✅ Phase A: queue, drawings/photos on jobs, actual days set at handover → overrun × rate | Install and production **calendar/queue**; attach **drawings (แบบ)** and files to project/work order; actual days counted from install start → handover; overrun shown as a billable extra | A |
| 8 | Handover: photos + delivery note signed by the customer | ✅ Phase A (handover + printed ใบส่งมอบงาน) | Handover record per work order: photos, printable **ใบส่งมอบงาน**, customer signature (on screen or signed scan), handover date → status 9 | A |
| 9 | Bill several times during the job (e.g. material on site before 100%) | ✅ triggers: deposit, before delivery, material on site, after delivery, substantial completion, progress | Auto-flag "ถึงเวลาวางบิล" from handover / material-on-site events | A |
| 10 | Chase payment (ทวงเงิน) | 🟡 Phase D built: ทวงเงิน page, chase-today list, follow-up log with promise / next dates, reminder letter 1 / 2 / final | Follow-up log per bill (date, who, note, next follow-up), "ต้องทวงวันนี้" list, printable reminder letter | D |
| 11 | Repairs: check warranty from the quotation; in warranty → repair ticket + technician/production queue; out of warranty → new quotation (step 3) | ✅ Phase C: warranty per product type from handover, repair tickets with automatic warranty check, service / production job or new quotation | Warranty months per quotation (and per line if needed); warranty end = handover date + months; **ใบแจ้งซ่อม** with automatic in/out-of-warranty check; in → service work order in the queue (+ production if needed); out → new quotation linked to the original project | C |

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

## 5c. How CCSE works today (from real project files, 24/10/2026)

Studied: TARA 69-047 (Clipso + lighting), FAIRMONT 68-013/1 (fibre optic +
canoe), WYNN 69-037/1 (LED strip / Jedi flex, export) — quotation, WOS, the
production workbook (FORM WPS) — and the weekly technician schedule (ตารางงานช่าง).

**Quotation (QC26-55-207, R.05…)**
- Customer sees one SET / LOT price per item; underneath, internal lines are
  priced from list price with a discount chain (e.g. 30% · 10% · 10%).
- Warranty differs per product: Clipso 5 years, LED 2 years, power supply 1 year.
- Installation in **working days** ("8-10 WORKING DAYS"), overrun charged per day
  ("EXCEEDING 10 DAYS … 6,000 BAHT/DAY").
- Typical terms: 50% deposit / 30% material on site / 20% after substantial completion.

**Work order sheet (WOS)**
- Header: P/J NO (69-047, 68-013/1), quotation ref, ATTN, **contacts with phone
  numbers**, schedule note ("ประกอบ 17/9/69 ติดตั้ง สิ้นด.9").
- Same items as the BOQ but no prices, with the **actual model** (PENTA WIDE
  4000K, ELG-100-C700AB), layout ("7 โมดูล × 5 แถว") and **dated field notes**
  ("6/10/69 : พี่แขกวัดหลุมจริง") with old → new sizes / quantities.
- LED runs written as `L = (0.682M x 2SETS) + ([3.015M + 3.515M] x 2SETS)`
  (piece length × sets; [ ] = pieces joined into one run), per circuit (CKT. NO.).
- Bottom: material request (store / production sign) and finance approval
  (มี PO / ไม่มี PO / รับมัดจำแล้ว, or special case) + field officer signature.

**Production workbook (ใบผลิต)** — one row per run:
- item, fixture type code (LX-473.022.1), circuit, watt, dots, K, product
  (Strip, Slim Flex, Jedi V1/V2, Canoe, Flex…), profile colour / diffuser /
  mount / cable exit, cable type + length.
- Site length (cm) → pieces (max ~300 cm each) → **LED cut = site length rounded
  to the strip's cut step** (both the shorter and the longer option are shown with
  the difference), **profile cut = LED cut − 0.4 cm**, final length.
- Derived: heat-shrink = LED + 2 cm per piece; aluminium bars of 6 m; clips ≈ every
  40 cm (+ screws); load A = W/m × m ÷ 24 V for the power supply; assembly method
  (พับ LED / เฉลี่ยกลาง).
- LED catalogue (Data sheet): cut step per watt + dots, e.g. 4.8W/60 → 10 cm,
  7.2W/30 Nichia → 16.67 cm, 14.4W/180 → 3.33 cm, Flex 0612 → 5 cm.
- Summaries: totals per watt/dots/K; per item **WOS vs site (หน้างาน) vs
  difference**; Canoe pieces in standard sizes (0.2/0.3/0.4/0.5 m).
- **Material issue (ใบเบิกของ)** in up to 5 rounds + **returns (ใบคืนของ)** + extra
  issue, compared with WOS and site quantities.
- **Stickers** per piece: item, type, circuit, "7W 24V 2700K", length, circuit total.

**Weekly technician schedule (ตารางงานช่าง)**
- Rows = technicians in crews (colour groups), columns = Mon–Sat with dates.
- A cell = project + task ("TARA สำเพ็ง (ติดไฟ + Wiring + ขึ้นผ้า)"), spanning days
  and people; also non-project entries: "CCSE (ชั้น4)" workshop, "พัก" (off),
  public holiday column; red "**" = priority / note.

## 6. Features

Status: ✅ built · 🟡 partly built / in preview · ⬜ planned

### 6.1 Access and users
- ✅ Email + password sign-in; admin invites users by email (`/users`).
- ✅ Role-based menu and Row Level Security on every table.
- ✅ Sign-out clears all cached data.

### 6.2 Dashboard (`/dashboard`) ✅
- ✅ **วันนี้ต้องทำอะไร** (top of the page): jobs running today (technicians / production
  see only their own), open repair tickets, and for admin / accounting the bills to chase
  today and terms ready to bill — each tile opens the page to act on it.
- Overview per role. For accounting: **due to bill**, **overdue** (longest
  first, days in red) and the **latest 20 receipts**, each with THB totals.

### 6.3 Customers (`/customers`) ✅
- Customer master (code, name, contact, phone, email, address, tax ID).
- Technicians see customer names only, never contact details.

### 6.4 Projects (`/projects`, `/projects/$projectId`) ✅
- ✅ **Project fields for the WOS:** site contacts (ติดต่อหน้างาน) and schedule note
  (กำหนดการ ประกอบ / ติดตั้ง / ส่ง).
- ✅ **Delete project** (admin, only if no bill was ever issued — bills are
  financial records; close the project at status 11 instead): type the project code to confirm; removes
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
- ✅ **Final Rev from measurements** (BOQ tab, quote editors): contract vs
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
- ✅ **ใบผลิต (ตัดไฟ) — production sheet** for every line made with a cut-to-length
  LED strip (SKU "LED เส้น" via the line's or component's recipe; Neon flex rolls keep
  the roll plan): per piece × sets the site length, **LED cut rounded to the strip's cut
  step** (shorter / longer both shown, difference highlighted when large; rounded steps
  such as 16.67 = 50/3 cm are treated exactly so long runs do not drift), **profile cut =
  LED − 0.4 cm**, heat shrink (LED + 2 cm per piece), clips (every 40 cm), load
  (W/m × m ÷ 24 V); per line totals with 6 m aluminium bars and a 24 V power-supply
  suggestion at ≤ 80 % load (over 18.8 A → split the circuit). Per item (kept by
  project + item no., survives a new Rev): round down / up, assembly (พับ LED /
  เฉลี่ยกลาง), notified date (วันแจ้งผลิต), remark. On the ใบ Work tab and on
  production work orders; print `/print/production/$projectId` (A4 landscape).
- ✅ **เบิกของ / คืนของ (material issue rounds + returns)** on the ใบ Work tab: per SKU
  ใบงาน (WOS need) · หน้างาน (actual LED / profile metres from the production sheet) ·
  เบิกครั้งที่ 1 (the first "ยืนยันเบิกของ") · 2, 3 … (extra issues) · เบิกรวม · คืนของ ·
  ใช้จริง (highlighted when more than the WOS). The store (admin / stock) records an
  extra issue in a chosen round or a return; each one moves stock (issue / receive) and
  a return can never exceed what is out on the project. Print `/print/materials/$projectId`
  (ใบเบิกของ + ใบคืนของ with store / production sign-off columns).
- ✅ **Stickers** (`/print/stickers/$projectId`): one label per cut piece — item,
  fixture code, circuit, "7W 24V 2700K", length (m) and [circuit total]; 1–3 copies.
- ✅ **วัดหน้างาน (site measurement):** on survey jobs and on the ใบ Work tab,
  every work line of the current quotation gets the measured cut lengths in the
  WOS notation ("0.682x2 + [3.015+3.515]x2": x = sets, [ ] = joined pieces;
  plain "4.2+6.5" works too; the text is kept for the WOS, pieces are expanded), the measured quantity (summed from the cut lengths for
  metre units) and a note. No prices; all staff can enter it. A new Rev carries
  the measurements over.
- ✅ The production list shows the **measured** cut lengths / quantity in bold
  with "วัดจริง" (and the contract quantity when it differs) until the final
  Rev takes them in.

#### Payments tab (งวดเงิน) — admin and accounting only
- ✅ Payment terms (%, fixed amount, trigger condition, printed text).
- ✅ **Balance term (ยอดคงเหลือ):** one term per quotation can bill "total −
  every other term" (billed terms count at their billed amount), so the final
  bill after a re-measure closes the job exactly. The bill text says
  "(BALANCE)". The terms editor shows billed terms at their billed amount
  ("วางบิลแล้ว").
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
- ✅ **Handover (ส่งมอบงาน)** on installation / service jobs once
  released: photos of the finished work (required), receiver name and
  position, date, note, and the customer's signature on screen **or** a photo
  of the signed paper. Saving closes the job (done). For the last open
  installation job it also sets actual install days (**working days**:
  Monday–Friday from install start to handover, minus public holidays — as the
  quotations say) and moves the project from 6–8 to **9 ส่งมอบ**,
  which makes "งานแล้วเสร็จ" payment terms due.
- ✅ **ใบ Work (WOS) print** (`/print/wos/$projectId`) in the CCSE layout: DATE /
  SUBJ: WORK ORDER SHEET / PROJ / ATTN, P/J NO + ref, contacts (ติดต่อ) and schedule
  note from the project, items without prices with "- L = (0.682M x 2SETS) + …",
  measured quantity next to the crossed-out contract quantity, dated field notes
  ("24/10/69 : วัดหน้างานจริง — …"), material request table and the finance /
  special-case / field officer approvals (☑ มี PO / ไม่มี PO / รับมัดจำแล้ว / CEO
  อนุมัติ ticked from the project).
- ✅ **ใบส่งมอบงาน / DELIVERY NOTE** (`/print/handover/$woId`): letterhead,
  customer, project, site, job, items, up to 6 photos, customer signature and
  crew; print or PDF. No prices.

### 6.7b Job queue (`/queue`, คิวงาน) ✅
- ✅ **ตามคน (people × days)** — default view, like the paper ตารางงานช่าง: rows =
  crew members grouped by crew (colour band), columns Mon–Sat (Sunday optional),
  public holidays highlighted with their name. A cell shows the person's jobs that
  run that day plus non-project entries (CCSE โรงงาน / พัก-ลา / อื่นๆ with a note).
  Planners click a cell to put the person on a job (a job without a date starts that
  day) or add an entry for one or more days.
- ✅ **Crews (จัดการทีมช่าง):** technicians are crew members with a name, crew, order
  and an optional login link ("งานของฉัน"); they do not need an account to be
  scheduled. Work orders are assigned to crew members.
- ตามวัน (by day) view as before.
- Week view (Mon–Sun) of all jobs that are not cancelled; multi-day jobs show
  on every day; jobs without a date are listed separately.
- Filter by job type and person, or "งานของฉัน" (my jobs); technicians and
  production staff open on their own jobs. Done jobs hidden unless ticked.
- Each card: type colour, job no., project, site address, people, status.

Tested end to end on 24/10/2026 (assign, uploads, queue, handover with signature, project 6 → 9, actual install days, delivery note print/PDF).
- Release blocked until project status ≥ 6. No prices anywhere.

### 6.7c Warranty & repairs (Phase C) ✅
- **Warranty per product type**, counted from handover (last installation handover, else
  the day the project reached 9 ส่งมอบ); months per SKU category, editable in settings.
  Until rules are saved the app uses the defaults from the quotations (Clipso fabric /
  track 60, LED ribbon / module / Neon flex 24, Power supply 12); "บันทึกค่าตั้งต้น"
  saves them (the migration carries no data rows, as Lovable requires). A warranty runs to the day before the anniversary.
- **Project overview → การรับประกัน:** start date and each product type in the current
  quotation with its end date (active / expired); "แจ้งซ่อม" button.
- **งานซ่อม** (`/repairs`, menu): ใบแจ้งซ่อม SR69-0001 (numbered per Buddhist year) with
  date, reporter, problem and the failed part; the warranty of that part is checked on
  the spot and saved with the ticket. In warranty → "สร้างใบงานซ่อม" creates a service
  work order (+ a production work order when "ต้องผลิตด้วย") that goes into the queue;
  out of warranty → "เสนอราคาใหม่" opens a new project (customer, ATTN, site copied,
  code = original code + ticket no.) for a new quotation (back to step 3). Statuses:
  รับแจ้ง → ลงคิวช่างแล้ว → ซ่อมเสร็จ / เสนอราคาใหม่ → ปิดงาน / ยกเลิก. Tickets also
  listed on the project page.

### 6.7d Collections — ทวงเงิน (Phase D) 🟡
- **ทวงเงิน** page (`/collections`, admin / accounting): totals outstanding / overdue /
  to chase today; **ต้องทวงวันนี้** = bills whose next follow-up date has come, whose
  promised payment date has passed, that are overdue and never followed up, or overdue
  with the last follow-up over 7 days ago and nothing planned; then every unpaid bill
  with days overdue, last follow-up, promise and next date.
- **Follow-up log per bill:** date, channel (โทร / LINE / อีเมล / เข้าพบ / จดหมาย),
  contact, what was said, promised payment date, next follow-up date.
- **ใบทวงถาม** (`/print/reminder/$billId`): letterhead, Thai date, เรื่อง / เรียน /
  โครงการ, wording for ครั้งที่ 1 / ครั้งที่ 2 / ฉบับสุดท้าย (suggested from the letters
  already logged), every unpaid bill of the project with due date and days overdue,
  total in figures and Thai words, bank account, signer.

### 6.8 Settings (`/settings`) ✅
- ✅ **Warranty months per product type** (SKU category), admin.
- ✅ **Public holidays (วันหยุดนักขัตฤกษ์):** admin list by year; not working days
  and shown on the technician schedule.
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
- ✅ Workflow phases A–D built (section 5b); corrected migrations 0015–0019 applied unchanged in journal order on 24/10/2026.
- ✅ Database support for crews/scheduling, production choices, extra issues/returns, warranty/repairs and payment follow-ups is applied: nine tables with RLS, authenticated/service-role grants, no anonymous table access, and their triggers verified.
- ✅ End-to-end tested in the app on 26/10/2026 (throwaway data, deleted afterwards): crews + people × days schedule + holiday column, cell dialog (assign job, พัก entry), measurement "0.78x2 + [3.015+3.515]x2" → 14.62 m, production choices (round up 78 → 83.33), WOS print with contacts / schedule note / joined run, round 1 + extra issue round 2 + return (over-return refused), handover → 4 working days across a weekend and a holiday → status 9, warranty card from defaults, SR69-0001 in warranty → service + production work orders, SR69-0002 → new quotation project.
- 🟡 Collections (Phase D) not yet tested with real data: it needs an issued bill, which cannot be deleted afterwards — check it with the first real overdue bill.
- Warranty rules start empty; the existing app uses its default warranty months until settings are saved. No warranty seed rows were inserted by migration 0018.
- Repair ticket numbers remain generated by the BEFORE INSERT trigger; an empty column default lets generated client types accept new tickets without a caller-supplied number.
- ⬜ Final Rev: line recipes with fixed quantities (custom builder blocks) are copied as they are — re-open the builder if a measured length changes material, e.g. LED strip or profile pieces.

## 10. Change log

| Date | Change |
|---|---|
| 26/10/2026 | Payment team can set 10 วางบิล and close the project (11) from the งวดเงิน tab once everything is received. Migration `0026_finance_close_project` pending in Lovable. |
| 26/10/2026 | **Cost privacy:** purchase team sees costs and purchases of local SKUs only (imports: admin); payment team no longer sees costs or purchases; only admin changes a SKU's local / import source; sale team sees the งวดเงิน tab read only (bills, money received). Migration `0025_cost_privacy` pending in Lovable. |
| 26/10/2026 | **Team access:** sale (sales + estimator) / purchase (stock) / payment (accounting) / production / technician rules — sale sees selling prices and stock but no costs; purchase sees costs but no selling prices; payment reads the BOQ and purchases but no longer records purchases; production sheet edited by production only; technicians lose the project list and get a WOS link on the job. Migration `0024_team_access` pending in Lovable. |
| 26/10/2026 | Applied `0022_install_starts_status8` unchanged in journal order via checkpoint migration 0023; verified its source hash, enabled installation-start trigger, 6–7 → 8 guard and restricted function permissions. No app logic changed. |
| 26/10/2026 | Flow walkthrough fixes: dashboard "วันนี้ต้องทำอะไร" panel; handover only on installation / repair jobs (not on surveys); project moves to 8 ติดตั้ง automatically when an installation job starts, so step-8 payment terms become due (migration `0022_install_starts_status8`, applied in Lovable). |
| 26/10/2026 | End-to-end test after Lovable applied 0015–0021: crews / schedule / holidays, measurement notation, production choices, WOS print, issue rounds + returns, working-day handover, warranty + repair tickets all work; test data removed. Collections waits for a real bill. |
| 24/10/2026 | Applied corrected, synced migrations `0015_crew_schedule_wos` through `0019_payment_followups` unchanged in journal order; verified nine tables, RLS/grants, columns, triggers and migration hashes; refreshed generated types and passed 34 existing tests. Added a trigger-managed default for repair ticket numbers to resolve generated insert-type compatibility without changing app code. |
| 24/10/2026 | Lovable blocked 0015 / 0018: crew login link is now a plain UUID (no FK to `auth.users`), and 0018 no longer seeds warranty rows — the app falls back to the quotation defaults and settings can save them. |
| 24/10/2026 | **Phase D — collections:** ทวงเงิน page with the chase-today list (next follow-up due, promise missed, overdue never chased, overdue stale > 7 days), follow-up log per bill, reminder letter ครั้งที่ 1 / 2 / ฉบับสุดท้าย. Migration `0019_payment_followups` pending in Lovable. |
| 24/10/2026 | **Phase C — warranty & repairs:** warranty months per product type (Clipso 60 / LED 24 / PSU 12, editable), project warranty card from handover, ใบแจ้งซ่อม (SR69-0001) with automatic warranty check → service (+ production) work order, or a new quotation project when out of warranty. Migration `0018_warranty_repairs` pending in Lovable. |
| 24/10/2026 | **Material issue rounds + returns** (ใบเบิกของ / ใบคืนของ): summary per SKU — WOS · site · round 1, 2, 3 … · issued · returned · used; store records extra issues and returns, stock follows. Tested with the Wynn numbers (WOS 88, site 143.17, issued 147, returned 3.83). Migration `0017_material_moves` pending in Lovable. |
| 24/10/2026 | **Production sheet (ใบผลิต ตัดไฟ)** with the workbook rules (cut-step rounding shorter/longer, profile −0.4 cm, heat shrink +2 cm, clips, 6 m bars, amps, PSU suggestion) and **stickers per piece**; tested against the Wynn numbers (78 → 66.67, 163.6 → 150). Migration `0016_production_settings` pending in Lovable. |
| 24/10/2026 | Fixes from the real files: install days in **working days** (Mon–Fri minus public holidays, holiday list in settings); **people × days** technician schedule with crews (no login needed), workshop / off entries; **WOS print** in the CCSE layout with contacts, schedule note, measured vs contract, dated notes and approvals; measurements typed as **length × sets** ("0.682x2 + [3.015+3.515]x2"). Migration `0015_crew_schedule_wos` pending in Lovable. |
| 24/10/2026 | Added section 5c: how CCSE works today, from the TARA / FAIRMONT / WYNN files (quotation, WOS, production workbook) and the weekly technician schedule. |
| 24/10/2026 | Phase B tested end to end (measure 10 → 10.7 m, final Rev B, balance bill 3,049.50 so total billed = final total 5,724.50). Fixes: terms editor shows billed amounts; delete project refuses when bills exist; role lookup retries after a page load so menus don't come up empty. |
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
