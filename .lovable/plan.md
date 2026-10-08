# วางบิลและบันทึกรับเงินต่องวด

## สิ่งที่มีอยู่ตอนนี้
- งวดเงินผูกกับใบเสนอราคาปัจจุบัน มี %, จำนวนเงินคงที่, เงื่อนไขเบิก และช่องติ๊ก "รับเงินแล้ว" + วันที่รับ (รับได้ครั้งเดียว ไม่มียอดเงินจริง)
- สถานะตอนนี้: รับแล้ว / ถึงเวลาเบิก / เช็ค progress / ยังไม่ถึง
- เห็นและแก้ได้เฉพาะ admin และบัญชี (ตรวจที่ระบบหลังบ้าน)
- หมายเหตุ: ตอนสร้าง Rev ใหม่ งวดเงินถูกคัดลอกไปด้วย — ใบวางบิลและใบรับเงินจะคัดลอกตามไปที่งวดใหม่ด้วย เพื่อไม่ให้ประวัติหาย

## สิ่งที่จะเพิ่ม (หน้าจอ)
1. ในแท็บ "งวดเงิน" แต่ละงวดมีปุ่ม **วางบิล** — กรอกเลขที่ใบวางบิล, วันที่วางบิล, เครดิต (ค่าเริ่มต้น 15 วัน) ระบบคำนวณวันครบกำหนดให้ (แก้ไขใบวางบิลได้)
2. ปุ่ม **บันทึกรับเงิน** — วันที่รับ, จำนวนเงิน, วิธีรับ (โอน / เช็ค / เงินสด), ธนาคารหรือเลขเช็ค, ภาษีหัก ณ ที่จ่าย (ไม่บังคับ), แนบสลิป (รูป/PDF), หมายเหตุ รับได้หลายครั้งต่องวด
3. ใต้แต่ละงวดแสดงรายการรับเงิน พร้อมดูสลิป และยอดคงค้าง; ด้านบนแสดงยอดคงค้างรวมของโปรเจกต์
4. สถานะงวดใหม่:
   - **รับครบ** — รับรวม + ภาษีหัก ≥ ยอดงวด
   - **เกินกำหนด (X วัน)** สีแดง — เลยวันครบกำหนดแล้วยังรับไม่ครบ
   - **รับบางส่วน** — มีรับเงินแต่ยังไม่ครบ ยังไม่เลยกำหนด
   - **วางบิลแล้ว** — วางบิลแล้ว ยังไม่ได้รับเงิน
   - **ถึงเวลาวางบิล** — สถานะโปรเจกต์ถึงขั้นของเงื่อนไข (งวด "ตามความคืบหน้า" ยังขึ้น "เช็ค progress" ให้ตัดสินใจเอง)
   - **ยังไม่ถึง**
5. ลบใบรับเงิน: เฉพาะ admin และต้องกรอกเหตุผล (ไม่ลบจริง เก็บไว้เป็นประวัติว่าใครยกเลิก เมื่อไหร่ เพราะอะไร)
6. ประวัติ: ทุกการวางบิล/แก้ไข/รับเงิน/ยกเลิก บันทึกว่าใครทำ เมื่อไหร่ ดูได้ในแท็บงวดเงิน
7. ภาพรวมงาน (ฝ่ายบัญชี) เปลี่ยนเป็น 3 ตาราง พร้อมยอดรวมบาท:
   - ถึงเวลาวางบิล
   - เกินกำหนดชำระ (เกินนานสุดก่อน, แสดงจำนวนวันสีแดง)
   - รับเงินล่าสุด (20 รายการ)
8. ช่องติ๊ก "รับเงินแล้ว" แบบเดิมจะเลิกใช้ (ข้อมูลเดิมยังเก็บไว้ งวดที่ติ๊กไว้แล้วจะแสดงเป็น "รับครบ" ต่อไป)

ช่างและฝ่ายผลิตมองไม่เห็นส่วนนี้ทั้งหมด รวมถึงไฟล์สลิป

## Technical details
- New tables (RLS, `private.can_manage_payments`, no anon grants):
  - `payment_billings` (term_id unique, bill_no, bill_date, credit_days default 15, due_date generated = bill_date + credit_days, created_by/at, updated_by/at)
  - `payment_receipts` (term_id, received_date, amount, method check transfer|cheque|cash, bank_ref, wht_amount default 0, slip_path, note, created_by/at, voided_at, voided_by, void_reason). No DELETE policy; void via `private.void_receipt(id, reason)` admin-only, reason required.
  - `payment_audit_log` (entity, entity_id, term_id, action, data jsonb, by, at) filled by triggers; read-only to managers.
- Private storage bucket `payment-slips` (image/PDF, size limit), storage policies by can_manage_payments; open via signed URLs.
- Extend `private.payment_schedule` (new return columns: billed info, due_date, received_total, wht_total, outstanding, days_overdue, new due_status values). Legacy `received=true` maps to รับครบ. Return-type change requires drop+recreate of private and public wrapper in one migration.
- Revision copy function extended to copy billings/receipts to new term ids.
- UI: dialogs in `PaymentTermsSection.tsx`; dashboard sections in `dashboard.tsx`; `DUE_LABELS` updated.
- Unit test for status rule (paid+WHT ≥ amount, overdue days).
