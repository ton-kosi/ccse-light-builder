import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { SearchPicker } from "@/components/SearchPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/routes/_authenticated/customers";
import { useSuppliers } from "@/routes/_authenticated/suppliers";
import { useMe } from "@/hooks/useMe";
import { fetchAll } from "@/lib/fetchAll";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
import { isoDate } from "@/lib/jobs";
import {
  db,
  lineAmount,
  netPrice,
  nextPoRev,
  PO_STATUS,
  poLabel,
  poTotals,
  remainingQty,
  type PoLine,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";

export const Route = createFileRoute("/_authenticated/purchase-orders/$poId")({
  head: () => ({
    meta: [
      { title: "ใบสั่งซื้อ | CCSE ERP" },
      { name: "description", content: "แก้ไขใบสั่งซื้อ พิมพ์ และรับของเข้าสต็อก" },
      { property: "og:title", content: "ใบสั่งซื้อ | CCSE ERP" },
      { property: "og:description", content: "ใบสั่งซื้อ (PO)" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PoPage,
});

type EditLine = { id: string; isNew: boolean; sku_id: string; description: string; qty: string; unit: string; unit_price: string; discount_percent: string; received_qty: number };
type Head = Omit<PurchaseOrder, "id" | "created_at" | "vat_percent"> & { vat_percent: string };

const toEdit = (l: PoLine): EditLine => ({
  id: l.id,
  isNew: false,
  sku_id: l.sku_id ?? "",
  description: l.description,
  qty: String(Number(l.qty)),
  unit: l.unit ?? "",
  unit_price: String(Number(l.unit_price)),
  discount_percent: Number(l.discount_percent) ? String(Number(l.discount_percent)) : "",
  received_qty: Number(l.received_qty ?? 0),
});
const blank = (): EditLine => ({ id: crypto.randomUUID(), isNew: true, sku_id: "", description: "", qty: "", unit: "", unit_price: "", discount_percent: "", received_qty: 0 });

function PoPage() {
  const { poId } = Route.useParams();
  const { has, isAdmin } = useMe();
  const allowed = has("admin", "stock");
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["purchase_order", poId],
    enabled: allowed,
    queryFn: async () => {
      const { data: po, error } = await db("purchase_orders").select("*").eq("id", poId).single();
      if (error) throw new Error(error.message);
      const { data: lines, error: e2 } = await db("purchase_order_lines").select("*").eq("po_id", poId).order("sort_order");
      if (e2) throw new Error(e2.message);
      return { po: po as PurchaseOrder, lines: (lines ?? []) as PoLine[] };
    },
  });
  const { data: suppliers } = useSuppliers();
  const { data: skus } = useQuery({
    queryKey: ["skus", "po-pick"],
    queryFn: () =>
      fetchAll<{ id: string; code: string; name: string; unit: string | null; source: string | null }>((f, t) =>
        supabase.from("skus").select("id, code, name, unit, source").order("code").range(f, t),
      ),
  });
  const { data: projects } = useQuery({
    queryKey: ["projects", "po-pick"],
    queryFn: () => fetchAll((f, t) => supabase.from("projects").select("id, code, name").order("code", { ascending: false }).range(f, t)),
  });

  const [head, setHead] = useState<Head | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => {
    if (!data) return;
    const { id: _i, created_at: _c, vat_percent, ...rest } = data.po;
    setHead({ ...rest, vat_percent: String(Number(vat_percent)) });
    setLines(data.lines.length ? data.lines.map(toEdit) : [blank()]);
    setRemoved([]);
  }, [data]);

  const skuById = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);
  const skuOptions = useMemo(
    () =>
      (skus ?? [])
        // imported SKUs are bought by admin
        .filter((s) => isAdmin || s.source !== "import")
        .map((s) => ({ id: s.id, label: s.code, sub: s.name, search: [s.code, s.name] })),
    [skus, isAdmin],
  );
  const supplierOptions = useMemo(
    () => (suppliers ?? []).map((s) => ({ id: s.id, label: s.name, sub: [s.code, s.contact_person, s.phone].filter(Boolean).join(" · "), search: [s.code, s.name, s.contact_person] })),
    [suppliers],
  );
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ id: p.id, label: p.code, sub: p.name, search: [p.code, p.name] })), [projects]);

  const locked = !head || head.status === "revised" || head.status === "cancelled";
  const parsed = lines.map((l) => ({ ...l, q: toNumber(l.qty) ?? 0, p: toNumber(l.unit_price) ?? 0, d: toNumber(l.discount_percent) ?? 0 }));
  const totals = poTotals(
    parsed.map((l) => ({ qty: l.q, unit_price: l.p, discount_percent: l.d })),
    toNumber(head?.vat_percent ?? "7") ?? 0,
  );

  const save = useMutation({
    mutationFn: async (nextStatus?: PurchaseOrder["status"]) => {
      if (!head) return;
      const keep = parsed.filter((l) => l.description.trim() || l.sku_id || l.qty);
      if (!head.supplier_name.trim()) throw new Error("เลือกหรือพิมพ์ชื่อผู้ขาย");
      keep.forEach((l, i) => {
        if (!l.description.trim()) throw new Error(`แถว ${i + 1}: ใส่รายการ`);
        if (!(l.q > 0)) throw new Error(`แถว ${i + 1}: จำนวนต้องมากกว่า 0`);
        if (l.p < 0 || l.d < 0 || l.d > 100) throw new Error(`แถว ${i + 1}: ราคา / ส่วนลดไม่ถูกต้อง`);
        if (l.received_qty > 0 && l.q < l.received_qty) throw new Error(`แถว ${i + 1}: รับของแล้ว ${l.received_qty} — จำนวนน้อยกว่านั้นไม่ได้`);
      });
      const { po_no: _n, rev: _r, company_id: _co, ...editable } = head;
      const { error } = await db("purchase_orders")
        .update({ ...editable, vat_percent: toNumber(head.vat_percent) ?? 7, status: nextStatus ?? head.status, updated_at: new Date().toISOString() })
        .eq("id", poId);
      if (error) throw new Error(error.message);
      for (const id of removed) {
        const { error: e } = await db("purchase_order_lines").delete().eq("id", id);
        if (e) throw new Error(e.message);
      }
      for (const [i, l] of keep.entries()) {
        const row = {
          sort_order: (i + 1) * 10,
          sku_id: l.sku_id || null,
          description: l.description.trim(),
          qty: l.q,
          unit: l.unit.trim() || null,
          unit_price: l.p,
          discount_percent: l.d,
        };
        const { error: e } = l.isNew
          ? await db("purchase_order_lines").insert({ ...row, id: l.id, po_id: poId })
          : await db("purchase_order_lines").update(row).eq("id", l.id);
        if (e) throw new Error(`แถว ${i + 1}: ${e.message}`);
      }
    },
    onSuccess: () => {
      toast.success("บันทึกใบสั่งซื้อแล้ว");
      qc.invalidateQueries({ queryKey: ["purchase_order", poId] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revise = useMutation({
    mutationFn: async () => {
      if (!head || !data) return;
      if (data.lines.some((l) => Number(l.received_qty) > 0)) throw new Error("รับของจากใบนี้แล้ว — แก้ในใบเดิม หรือออกใบใหม่");
      const { po_no, company_id, ...rest } = head;
      const { data: copy, error } = await db("purchase_orders")
        .insert({ ...rest, company_id, po_no, rev: nextPoRev(head.rev), status: "ordered", vat_percent: toNumber(head.vat_percent) ?? 7 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const newId = (copy as { id: string }).id;
      if (data.lines.length) {
        const { error: e } = await db("purchase_order_lines").insert(
          data.lines.map(({ id: _id, po_id: _p, received_qty: _r, ...l }) => ({ ...l, po_id: newId })),
        );
        if (e) throw new Error(e.message);
      }
      const { error: e3 } = await db("purchase_orders").update({ status: "revised" }).eq("id", poId);
      if (e3) throw new Error(e3.message);
      return newId;
    },
    onSuccess: (id) => {
      toast.success("สร้างฉบับแก้ไขแล้ว");
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      if (id) navigate({ to: "/purchase-orders/$poId", params: { poId: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!allowed) return <p className="text-sm text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบและทีมจัดซื้อ</p>;
  if (isLoading || !head) return <p className="text-sm text-muted-foreground">กำลังโหลด…</p>;

  const st = PO_STATUS[head.status];
  const set = <K extends keyof Head>(k: K, v: Head[K]) => setHead({ ...head, [k]: v });
  const setLine = (id: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const dirty = JSON.stringify(lines.map((l) => [l.sku_id, l.description, l.qty, l.unit, l.unit_price, l.discount_percent])) !==
    JSON.stringify((data?.lines ?? []).map((l) => { const e = toEdit(l); return [e.sku_id, e.description, e.qty, e.unit, e.unit_price, e.discount_percent]; }));

  return (
    <div>
      <PageHeader
        title={`ใบสั่งซื้อ ${poLabel(head)}`}
        description={`${head.company_id === "one" ? "One Engineering" : "CCSE"} · ${st.label}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/purchase-orders">กลับรายการ</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/print/po/$poId" params={{ poId }} target="_blank">
                พิมพ์ / PDF
              </Link>
            </Button>
            {!locked ? (
              <>
                {head.status === "draft" ? (
                  <Button size="sm" disabled={save.isPending} onClick={() => save.mutate("ordered")}>
                    บันทึกและสั่งซื้อ
                  </Button>
                ) : null}
                <Button size="sm" variant={head.status === "draft" ? "outline" : "default"} disabled={save.isPending} onClick={() => save.mutate(undefined)}>
                  บันทึก
                </Button>
                {head.status !== "draft" ? (
                  <Button size="sm" variant="outline" disabled={revise.isPending} onClick={() => confirm(`ออกฉบับแก้ไข ${head.po_no} ${nextPoRev(head.rev)}? ใบนี้จะถูกเก็บไว้เป็นฉบับเก่า`) && revise.mutate()}>
                    ออกฉบับแก้ไข ({nextPoRev(head.rev)})
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm("ยกเลิกใบสั่งซื้อนี้?") && save.mutate("cancelled")}>
                  ยกเลิก
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <section className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-4">
        <Field label="ผู้ขาย (เลือกจากรายชื่อ)" className="md:col-span-2">
          <SearchPicker
            options={supplierOptions}
            value={head.supplier_id ?? ""}
            disabled={locked}
            emptyLabel="— พิมพ์ชื่อเอง —"
            onChange={(id) => {
              const s = suppliers?.find((x) => x.id === id);
              setHead({
                ...head,
                supplier_id: id || null,
                ...(s
                  ? {
                      supplier_name: s.name,
                      attn: s.contact_person ?? head.attn,
                      phone: s.phone ?? head.phone,
                      fax: s.fax ?? head.fax,
                      credit_text: s.credit_days != null ? `CR. ${s.credit_days} DAYS` : head.credit_text,
                    }
                  : {}),
              });
            }}
          />
        </Field>
        <Field label="ชื่อผู้ขายในใบ *" className="md:col-span-2">
          <Input value={head.supplier_name} disabled={locked} onChange={(e) => set("supplier_name", e.target.value)} />
        </Field>
        <Field label="เรียน (ATTENTION)">
          <Input value={head.attn ?? ""} disabled={locked} onChange={(e) => set("attn", e.target.value || null)} />
        </Field>
        <Field label="โทรศัพท์">
          <Input value={head.phone ?? ""} disabled={locked} onChange={(e) => set("phone", e.target.value || null)} />
        </Field>
        <Field label="แฟกซ์">
          <Input value={head.fax ?? ""} disabled={locked} onChange={(e) => set("fax", e.target.value || null)} />
        </Field>
        <Field label="วันที่">
          <Input type="date" value={head.date} disabled={locked} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="โครงการ (งาน)" className="md:col-span-2">
          <SearchPicker
            options={projectOptions}
            value={head.project_id ?? ""}
            disabled={locked}
            emptyLabel="— STOCK / ไม่ผูกงาน —"
            onChange={(id) => {
              const p = projects?.find((x) => x.id === id);
              setHead({ ...head, project_id: id || null, run_label: p ? p.code : head.run_label || "STOCK" });
            }}
          />
        </Field>
        <Field label="RUN (พิมพ์ในใบ)">
          <Input value={head.run_label ?? ""} placeholder="STOCK / 69-047" disabled={locked} onChange={(e) => set("run_label", e.target.value || null)} />
        </Field>
        <Field label="VAT %">
          <Input inputMode="decimal" value={head.vat_percent} disabled={locked} onChange={(e) => set("vat_percent", e.target.value)} />
        </Field>
        <Field label="กำหนดส่ง / DELIVERY">
          <Input value={head.delivery_text ?? ""} placeholder="รอของ 45-60 วัน" disabled={locked} onChange={(e) => set("delivery_text", e.target.value || null)} />
        </Field>
        <Field label="สถานที่ส่ง / SHIP TO">
          <Input value={head.ship_to ?? ""} disabled={locked} onChange={(e) => set("ship_to", e.target.value || null)} />
        </Field>
        <Field label="เงื่อนไขชำระเงิน / CREDIT">
          <Input value={head.credit_text ?? ""} placeholder="CR. 30 DAYS" disabled={locked} onChange={(e) => set("credit_text", e.target.value || null)} />
        </Field>
        <Field label="หมายเหตุ (ภายใน)">
          <Textarea value={head.note ?? ""} disabled={locked} onChange={(e) => set("note", e.target.value || null)} />
        </Field>
      </section>

      <section className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">SKU (เข้าสต็อก)</th>
              <th className="px-2 py-2">รายการ (พิมพ์ในใบ)</th>
              <th className="px-2 py-2 text-right">จำนวน</th>
              <th className="px-2 py-2">หน่วย</th>
              <th className="px-2 py-2 text-right">ราคา/หน่วย</th>
              <th className="px-2 py-2 text-right">ส่วนลด %</th>
              <th className="px-2 py-2 text-right">จำนวนเงิน</th>
              <th className="px-2 py-2 text-right">รับแล้ว</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {parsed.map((l, i) => (
              <tr key={l.id} className="border-t border-border align-top">
                <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                <td className="w-56 px-2 py-1.5">
                  <SearchPicker
                    options={skuOptions}
                    value={l.sku_id}
                    disabled={locked || l.received_qty > 0}
                    emptyLabel="— ไม่เข้าสต็อก —"
                    onChange={(id) => {
                      const s = skuById.get(id);
                      setLine(l.id, { sku_id: id, ...(s ? { description: l.description || s.name, unit: l.unit || (s.unit ?? "") } : {}) });
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input value={l.description} disabled={locked} onChange={(e) => setLine(l.id, { description: e.target.value })} />
                </td>
                <td className="w-24 px-2 py-1.5">
                  <Input className="text-right" inputMode="decimal" value={l.qty} disabled={locked} onChange={(e) => setLine(l.id, { qty: e.target.value })} />
                </td>
                <td className="w-20 px-2 py-1.5">
                  <Input value={l.unit} placeholder="PCS" disabled={locked} onChange={(e) => setLine(l.id, { unit: e.target.value })} />
                </td>
                <td className="w-28 px-2 py-1.5">
                  <Input className="text-right" inputMode="decimal" value={l.unit_price} disabled={locked} onChange={(e) => setLine(l.id, { unit_price: e.target.value })} />
                </td>
                <td className="w-20 px-2 py-1.5">
                  <Input className="text-right" inputMode="decimal" value={l.discount_percent} disabled={locked} onChange={(e) => setLine(l.id, { discount_percent: e.target.value })} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatTHB(lineAmount({ qty: l.q, unit_price: l.p, discount_percent: l.d }))}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.sku_id ? formatQty(l.received_qty) : "-"}</td>
                <td className="px-1 py-1.5">
                  {!locked && l.received_qty === 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => {
                        if (!l.isNew) setRemoved((r) => [...r, l.id]);
                        setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.id !== l.id) : [blank()]));
                      }}
                    >
                      ลบ
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={7} className="px-2 py-1.5">
                {!locked ? (
                  <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}>
                    + เพิ่มรายการ
                  </Button>
                ) : null}
              </td>
              <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                รวม {formatTHB(totals.subtotal)}
                <br />
                VAT {formatTHB(totals.vat)}
                <br />
                <b className="text-sm text-foreground">{formatTHB(totals.total)}</b>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </section>

      {data ? <ReceiveSection po={data.po} lines={data.lines} dirty={dirty} skuCode={(id) => skuById.get(id)?.code ?? ""} /> : null}
    </div>
  );
}

/** รับของ: what arrived goes into stock as a purchase at the PO's net price. */
function ReceiveSection({ po, lines, dirty, skuCode }: { po: PurchaseOrder; lines: PoLine[]; dirty: boolean; skuCode: (id: string) => string }) {
  const qc = useQueryClient();
  const open = lines.filter((l) => l.sku_id && remainingQty(l) > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [date, setDate] = useState(isoDate(new Date()));
  const [docNo, setDocNo] = useState("");
  useEffect(() => setQty(Object.fromEntries(open.map((l) => [l.id, String(remainingQty(l))]))), [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const receive = useMutation({
    mutationFn: async () => {
      const rows = open
        .map((l) => ({ l, q: toNumber(qty[l.id] ?? "") ?? 0 }))
        .filter((x) => x.q > 0);
      if (!rows.length) throw new Error("ใส่จำนวนที่รับ");
      for (const { l, q } of rows) {
        if (q > remainingQty(l) + 1e-9 && !confirm(`${skuCode(l.sku_id!)} รับ ${q} มากกว่าที่สั่งค้างอยู่ ${remainingQty(l)} — ยืนยัน?`)) return;
        const { error } = await (supabase.from("purchases") as unknown as { insert: (r: object) => PromiseLike<{ error: { message: string } | null }> }).insert({
          date,
          supplier: po.supplier_name || null,
          doc_no: docNo.trim() || null,
          note: `PO ${poLabel(po)}`,
          sku_id: l.sku_id,
          qty: q,
          unit_price: netPrice(l),
          extra_cost: 0,
          project_id: po.project_id,
          purchase_request_id: l.purchase_request_id,
          po_line_id: l.id,
        });
        if (error) throw new Error(`${skuCode(l.sku_id!)}: ${error.message}`);
      }
    },
    onSuccess: () => {
      toast.success("รับของเข้าสต็อกแล้ว — ต้นทุนอัปเดตตามราคาใน PO");
      setDocNo("");
      ["purchase_order", "purchase_orders", "purchases", "sku_on_hand", "stock_movements", "sku_costs", "material_demand"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (po.status === "draft" || po.status === "cancelled" || po.status === "revised") return null;
  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">รับของ</h2>
      {!open.length ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {lines.some((l) => l.sku_id) ? "รับของครบทุกรายการแล้ว" : "ใบนี้ไม่มีรายการที่ผูก SKU — ไม่ต้องรับเข้าสต็อก"}
        </p>
      ) : (
        <>
          {dirty ? <p className="mt-1 text-xs text-warning">มีการแก้รายการที่ยังไม่บันทึก — กดบันทึกก่อนรับของ</p> : null}
          <div className="mt-2 grid gap-3 md:grid-cols-4">
            <Field label="วันที่รับ">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="เลขที่บิล / ใบส่งของร้าน">
              <Input value={docNo} onChange={(e) => setDocNo(e.target.value)} />
            </Field>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">SKU</th>
                <th className="py-1">รายการ</th>
                <th className="py-1 text-right">ค้างรับ</th>
                <th className="py-1 text-right">รับครั้งนี้</th>
              </tr>
            </thead>
            <tbody>
              {open.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-1 font-mono text-xs">{skuCode(l.sku_id!)}</td>
                  <td className="py-1">{l.description}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatQty(remainingQty(l))} {l.unit ?? ""}
                  </td>
                  <td className="w-28 py-1">
                    <Input className="text-right" inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-3" size="sm" disabled={receive.isPending || dirty} onClick={() => receive.mutate()}>
            รับของเข้าสต็อก
          </Button>
        </>
      )}
    </section>
  );
}
