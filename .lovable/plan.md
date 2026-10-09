# ท้ายใบเสนอราคาแก้ได้ในแท็บ BOQ + ชุดข้อความหมายเหตุ/ประกัน

## สิ่งที่มีอยู่ตอนนี้
- ท้ายแท็บ BOQ มีแค่ยอดรวม ส่วนยืนราคา การส่งมอบ และหมายเหตุอยู่ด้านบนเป็นช่องธรรมดา
- งวดเงินแก้ได้เฉพาะในแท็บ "งวดเงิน"
- ยังไม่มีชุดข้อความหมายเหตุหรือประกัน และยังไม่มีการเลือกผู้ลงนาม

## A. ท้ายแท็บ BOQ (ใต้ตาราง เรียงเหมือนใบจริง)
1. **ยอดรวม:** Sub total, ส่วนลดพิเศษ (แก้ได้ตรงนี้), Total, VAT 7%, Grand total ถ้ามี Option จะแสดงยอดแยกทีละ Option
2. **หมายเหตุและประกัน:** ดูข้อ B
3. **สองคอลัมน์เหมือนใบพิมพ์**
   - ซ้าย: ข้อความปิดท้าย และผู้ลงนาม (เลือกจากรายชื่อผู้ใช้ ชื่อและตำแหน่งแก้ได้เฉพาะใบนี้)
   - ขวา: TERM OF PAYMENT (ย้ายตัวแก้งวดเงินมาไว้ตรงนี้), VALIDITY (วัน), DELIVERY (ข้อความ) และช่อง APPROVED BY
4. **ข้อความที่พิมพ์ของแต่ละงวด** เช่น "50% DEPOSIT" ระบบเติมให้จาก % และเงื่อนไขเบิก แก้ได้
5. ช่องยืนราคา การส่งมอบ ส่วนลด และหมายเหตุ ที่อยู่ด้านบนตอนนี้ จะย้ายลงมาไว้ท้ายแท็บ (ช่องเลขที่อ้างอิงและวันที่ยังอยู่ด้านบน)
6. **แท็บ "งวดเงิน":** แก้งวดไม่ได้แล้ว ใช้ดูอย่างเดียว ส่วนวางบิล ใบเบิกเงิน และบันทึกรับเงินยังทำที่แท็บนี้เหมือนเดิม
7. **สิทธิ์:** ฝ่ายขาย ผู้ประมาณราคา และ admin แก้ส่วนท้ายใบได้ ส่วนการแก้งวดเงินยังเป็นของ admin และบัญชีตามเดิม

> ต้องถามก่อน: ตอนนี้แก้งวดเงินได้เฉพาะ admin และบัญชี ถ้าย้ายมาไว้ใน BOQ ให้ผู้ประมาณราคาและฝ่ายขายแก้ % เงื่อนไขเบิก และข้อความที่พิมพ์ได้ด้วยไหม ข้อเสนอคือ "ได้" ถ้ายังไม่มีการวางบิลหรือรับเงินในงวดนั้น โดยจะเห็นแค่ % และข้อความ ไม่เห็นยอดรับเงิน

## B. ชุดข้อความ "หมายเหตุและประกัน"
1. **หน้าใหม่ในเมนู** (admin และผู้ประมาณราคา): แต่ละข้อมี หมวด (REMARK / WARRANTY / หมายเหตุ / WARNING), ข้อความ, ลำดับ, เปิดใช้ และติ๊ก "ทุกใบเสนอราคา" ได้
2. **ผูกข้อความกับชิ้นส่วนขาย:** หนึ่งข้อผูกได้หลายชิ้นส่วน หนึ่งชิ้นส่วนก็มีได้หลายข้อ ในหน้าแก้ชิ้นส่วนขายจะมีส่วนให้เลือกหรือเอาข้อความออก
3. **ในใบเสนอราคา ระบบรวมข้อความให้อัตโนมัติ** จากชิ้นส่วนในรายการที่นับรวม (เฉพาะ Option ที่ลูกค้าเลือก) และข้อที่ติ๊ก "ทุกใบเสนอราคา" ข้อที่ซ้ำจะขึ้นครั้งเดียว จัดตามหมวดและลำดับ
4. **ผู้ประมาณราคาปรับได้ทีละใบ:** ติ๊กเอาออก, แก้ข้อความเฉพาะใบนี้, เพิ่มข้อความเอง และเลื่อนลำดับ ข้อที่แก้หรือเพิ่มเองจะไม่หายเมื่อรายการเปลี่ยน ข้อที่ต้องใช้เพิ่มขึ้นมาใหม่จะติดป้าย "ใหม่" ส่วนข้อที่ไม่ได้ใช้แล้วและไม่ได้แก้ จะหายไปเอง
5. **สร้าง Rev ใหม่** จะคัดลอกหมายเหตุไปทั้งหมดตามที่เป็นอยู่

## C. ใบพิมพ์และ PDF
ยอดรวม → REMARK / WARRANTY / หมายเหตุ / WARNING (เฉพาะหมวดที่มีข้อความ) → "WE HOPE THAT OUR QUOTATION CAN BE OF CONSIDERABLE VALUE TO YOUR COMPANY." → สองคอลัมน์:
- ซ้าย: FAITHFULLY YOURS, ชื่อบริษัท, (ชื่อผู้ลงนาม), ตำแหน่ง
- ขวา: TERM OF PAYMENT ทุกงวด, VALIDITY, DELIVERY, APPROVED BY พร้อมเส้นลงชื่อและวันที่

ส่วนท้ายนี้จะไม่ถูกตัดข้ามหน้า ทั้งตอนพิมพ์และใน PDF

## Technical details
- New tables (RLS, authenticated + service_role grants only):
  - `quote_clauses` (id, section check remark|warranty|note_th|warning, text, sort_order, active, always_include)
  - `component_clauses` (component_id, clause_id, PK both)
  - `quotation_clauses` (id, quotation_id, clause_id nullable, section, text, sort_order, included bool, edited bool, is_new bool)
  - Read: quote roles (admin/sales/estimator). Write: admin/estimator for the clause master data, `private.can_edit_quote` for quotation_clauses.
- `quotations` additions (all nullable): closing_text, signer_user_id, signer_name, signer_position. `payment_terms.print_label` (nullable, filled in from percent + trigger when empty).
- Sync: `private.sync_quotation_clauses(quotation_id)` with a public wrapper. It adds missing clauses (is_new = true) and removes unedited ones that are no longer needed. The client calls it after line changes and when the BOQ opens.
- Extend `private.create_quotation_revision` to copy quotation_clauses and the new quotation columns.
- Payment-term edit RLS widened per the answer above. The terms editor component is shared between the BOQ tab and the read-only payment tab.
- Print route: new footer components inside a block with `break-inside: avoid`. buildA4Pdf moves the block to the next page when it would be split.
- Menu: new page `/clauses`. The component edit dialog gets a clause-link section.
