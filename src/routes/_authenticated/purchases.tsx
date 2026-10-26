import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CategoryFilter } from "@/components/stock/CategoryFilter";
import { useMe } from "@/hooks/useMe";
import { categoryOf } from "@/lib/skuCategory";
import { formatDate, formatQty, formatTHB, toNumber } from "@/lib/format";
import {
  isMissingTable,
  latestBySku,
  newestFirst,
  priceChange,
  skuSummary,
  unitCost,
} from "@/lib/purchases";

type Search = { pr?: string | undefined; sku?: string | undefined };

export const Route = createFileRoute("/_authenticated/purchases")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    pr: typeof s["pr"] === "string" ? s["pr"] : undefined,
    sku: typeof s["sku"] === "string" ? s["sku"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "ซื้อของ / ประวัติการซื้อ | CCSE ERP" },
      { name: "description", content: "บันทึกการซื้อของเข้าสต๊อก พร้อมประวัติราคาและจำนวนทุกครั้ง" },
      { property: "og:title", content: "ซื้อของ | CCSE ERP" },
      { property: "og:description", content: "ประวัติการซื้อและต้นทุนล่าสุดของ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PurchasesPage,
});

const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const today = () => new Date().toLocaleDateString("sv-SE");

type Line = {
  key: string;
  sku_id: string;
  qty: string;
  unit_price: string;
  extra_cost: string;
  project_id: string;
  purchase_request_id: string | null;
};
const newLine = (p: Partial<Line> = {}): Line => ({
  key: crypto.randomUUID(),
  sku_id: "",
  qty: "",
  unit_price: "",
  extra_cost: "",
  project_id: "",
  purchase_request_id: null,
  ...p,
});

function PurchasesPage() {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { has, isAdmin, isLoading: meLoading } = useMe();
  // purchase team: local SKUs only (the database hides imported SKUs' purchases and costs)
  const allowed = has("admin", "stock");
  const canRecord = allowed;
  const canBuy = (s: { source?: string | null } | undefined) => isAdmin || s?.source !== "import";

  const [head, setHead] = useState({ date: today(), supplier: "", doc_no: "", note: "" });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [skuFilter, setSkuFilter] = useState(search.sku ?? "");
  const [cat, setCat] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<Purchase | null>(null);

  const { data: skus } = useQuery({
    queryKey: ["skus"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("*").order("code");
      if (error) throw error;
      return data;
    },
  });
  const skuById = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);
  const { data: projects } = useQuery({
    queryKey: ["projects", "pick"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, code, name").order("code");
      if (error) throw error;
      return data;
    },
  });
  const purchasesQ = useQuery({
    queryKey: ["purchases"],
    enabled: allowed,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("*, projects(code)")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });
  const purchases = purchasesQ.data;
  const missing = isMissingTable(purchasesQ.error?.message);
  const { data: openPrs } = useQuery({
    queryKey: ["purchase_requests", "ordered"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_requests")
        .select("id, date, sku_id, qty, project_id, kind, note")
        .eq("status", "ordered")
        .order("date");
      if (error) throw error;
      return data;
    },
  });

  const latest = useMemo(() => latestBySku(purchases ?? []), [purchases]);
  const suppliers = useMemo(
    () => [...new Set((purchases ?? []).map((p) => p.supplier).filter(Boolean) as string[])].sort(),
    [purchases],
  );

  const addPr = (id: string) => {
    const pr = openPrs?.find((p) => p.id === id);
    if (!pr || lines.some((l) => l.purchase_request_id === id)) return;
    const line = newLine({
      sku_id: pr.sku_id,
      qty: String(Number(pr.qty)),
      project_id: pr.project_id ?? "",
      purchase_request_id: pr.id,
    });
    setLines((ls) => [...ls.filter((l) => l.sku_id || l.qty || l.unit_price), line]);
  };
  // "รับของ" from the purchase-request page lands here with ?pr=
  useEffect(() => {
    if (search.pr && openPrs) {
      addPr(search.pr);
      navigate({ to: "/purchases", search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.pr, openPrs]);

  const save = useMutation({
    mutationFn: async () => {
      const rows = lines.filter((l) => l.sku_id || l.qty || l.unit_price);
      if (!rows.length) throw new Error("ยังไม่มีรายการ");
      const payload = rows.map((l, i) => {
        const qty = toNumber(l.qty);
        const price = toNumber(l.unit_price);
        if (!l.sku_id) throw new Error(`แถว ${i + 1}: เลือก SKU`);
        if (!qty || qty <= 0) throw new Error(`แถว ${i + 1}: จำนวนต้องมากกว่า 0`);
        if (price === null || price < 0) throw new Error(`แถว ${i + 1}: ใส่ราคาต่อหน่วย`);
        return {
          date: head.date || today(),
          supplier: head.supplier.trim() || null,
          doc_no: head.doc_no.trim() || null,
          note: head.note.trim() || null,
          sku_id: l.sku_id,
          qty,
          unit_price: price,
          extra_cost: toNumber(l.extra_cost) ?? 0,
          project_id: l.project_id || null,
          purchase_request_id: l.purchase_request_id,
        };
      });
      // one at a time so each purchase request is received in order and errors name the row
      for (const [i, row] of payload.entries()) {
        const { error } = await supabase.from("purchases").insert(row);
        if (error) throw new Error(`แถว ${i + 1}: ${error.message}`);
      }
      return payload.length;
    },
    onSuccess: (n) => {
      toast.success(`บันทึกการซื้อ ${n} รายการ — รับเข้าสต๊อกและอัปเดตต้นทุนแล้ว`);
      setLines([newLine()]);
      setHead((h) => ({ ...h, doc_no: "", note: "" }));
      ["purchases", "purchase_requests", "sku_on_hand", "stock_movements", "sku_costs", "material_demand"].forEach(
        (k) => qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ลบแล้ว — หักสต๊อกคืนและคำนวณต้นทุนใหม่");
      ["purchases", "sku_on_hand", "stock_movements", "sku_costs"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!meLoading && !allowed)
    return (
      <div>
        <PageHeader title="ซื้อของ" />
        <p className="text-sm text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบและทีมจัดซื้อ</p>
      </div>
    );

  const q = text.trim().toLowerCase();
  const history = newestFirst(purchases ?? []).filter((p) => {
    const s = skuById.get(p.sku_id);
    if (skuFilter && p.sku_id !== skuFilter) return false;
    if (cat && (!s || categoryOf(s) !== cat)) return false;
    if (!q) return true;
    return [s?.code, s?.name, p.supplier, p.doc_no].some((x) => x?.toLowerCase().includes(q));
  });
  const summary = skuFilter ? skuSummary((purchases ?? []).filter((p) => p.sku_id === skuFilter)) : null;
  const filtSku = skuFilter ? skuById.get(skuFilter) : undefined;
  const total = lines.reduce(
    (s, l) => s + (toNumber(l.qty) ?? 0) * (toNumber(l.unit_price) ?? 0) + (toNumber(l.extra_cost) ?? 0),
    0,
  );

  return (
    <div>
      <PageHeader
        title="ซื้อของ"
        description="บันทึกทุกครั้งที่ซื้อ — รับของเข้าสต๊อกทันที และต้นทุนของ SKU จะเป็นราคาซื้อล่าสุด (ราคา + ค่าใช้จ่ายเพิ่ม ÷ จำนวน)"
      />

      {missing ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          ยังไม่ได้สร้างตารางเก็บประวัติการซื้อในฐานข้อมูล — ให้ Lovable รันไฟล์{" "}
          <code className="font-mono">docs/sql/purchases.sql</code> ก่อน แล้วหน้านี้จะใช้งานได้
        </div>
      ) : null}

      {canRecord ? (
      <form
        className="mb-6 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="วันที่ซื้อ">
            <Input type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
          </Field>
          <Field label="ผู้ขาย / ร้าน">
            <Input
              list="suppliers"
              value={head.supplier}
              onChange={(e) => setHead({ ...head, supplier: e.target.value })}
            />
            <datalist id="suppliers">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="เลขที่บิล / ใบกำกับ">
            <Input value={head.doc_no} onChange={(e) => setHead({ ...head, doc_no: e.target.value })} />
          </Field>
          <Field label="หมายเหตุ">
            <Input value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} />
          </Field>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-1 font-medium">SKU</th>
                <th className="w-24 pb-1 font-medium">จำนวน</th>
                <th className="w-32 pb-1 font-medium">ราคา/หน่วย (ก่อน VAT)</th>
                <th className="w-32 pb-1 font-medium" title="ค่าขนส่ง ภาษีนำเข้า ฯลฯ ของรายการนี้ทั้งก้อน">
                  ค่าใช้จ่ายเพิ่ม (รวม)
                </th>
                <th className="w-44 pb-1 font-medium">โปรเจกต์</th>
                <th className="w-48 pb-1 font-medium">ต้นทุน/หน่วย เทียบครั้งก่อน</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const upd = (p: Partial<Line>) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...p } : x)));
                const s = skuById.get(l.sku_id);
                const qty = toNumber(l.qty) ?? 0;
                const price = toNumber(l.unit_price);
                const cost = price !== null && qty > 0 ? unitCost({ qty, unit_price: price, extra_cost: toNumber(l.extra_cost) ?? 0 }) : null;
                const prev = l.sku_id ? latest.get(l.sku_id) : undefined;
                const prevCost = prev ? unitCost(prev) : null;
                const ch = cost !== null ? priceChange(prevCost, cost) : null;
                return (
                  <tr key={l.key} className="align-top">
                    <td className="py-1 pr-2">
                      <select
                        className={sel}
                        value={l.sku_id}
                        disabled={!!l.purchase_request_id}
                        onChange={(e) => upd({ sku_id: e.target.value })}
                      >
                        <option value="">— เลือก SKU —</option>
                        {(skus ?? []).filter(canBuy).map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.code} — {k.name}
                          </option>
                        ))}
                      </select>
                      {l.purchase_request_id ? (
                        <div className="mt-0.5 text-xs text-primary">รับของตามใบขอซื้อ</div>
                      ) : null}
                    </td>
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-1">
                        <Input inputMode="decimal" value={l.qty} onChange={(e) => upd({ qty: e.target.value })} />
                        <span className="text-xs text-muted-foreground">{s?.unit}</span>
                      </div>
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        inputMode="decimal"
                        value={l.unit_price}
                        placeholder={prev ? String(Number(prev.unit_price)) : ""}
                        onChange={(e) => upd({ unit_price: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input inputMode="decimal" value={l.extra_cost} placeholder="0" onChange={(e) => upd({ extra_cost: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <select className={sel} value={l.project_id} onChange={(e) => upd({ project_id: e.target.value })}>
                        <option value="">— สต๊อกกลาง —</option>
                        {(projects ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2 text-xs">
                      {cost !== null ? <div className="text-sm font-medium tabular-nums">{formatTHB(cost)}</div> : null}
                      {prev ? (
                        <div className="text-muted-foreground">
                          ครั้งก่อน {formatTHB(prevCost)} ({formatDate(prev.date)})
                          {ch !== null ? (
                            <span className={"ml-1 font-semibold " + (ch > 0 ? "text-destructive" : ch < 0 ? "text-success" : "")}>
                              {ch > 0 ? "▲" : ch < 0 ? "▼" : "="} {Math.abs(ch)}%
                            </span>
                          ) : null}
                        </div>
                      ) : l.sku_id ? (
                        <div className="text-muted-foreground">ซื้อครั้งแรก</div>
                      ) : null}
                    </td>
                    <td className="py-1 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}
                      >
                        ลบ
                      </Button>
                      <span className="sr-only">แถว {i + 1}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, newLine()])}>
            + เพิ่มรายการ
          </Button>
          {openPrs?.length ? (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value=""
              onChange={(e) => addPr(e.target.value)}
            >
              <option value="">+ รับของตามใบขอซื้อที่สั่งแล้ว ({openPrs.length})</option>
              {openPrs.map((p) => {
                const s = skuById.get(p.sku_id);
                return (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={!canBuy(s) || lines.some((l) => l.purchase_request_id === p.id)}
                  >
                    {formatDate(p.date)} · {s?.code} — {formatQty(Number(p.qty))} {s?.unit}
                    {p.note ? ` · ${p.note}` : ""}
                    {!canBuy(s) ? " · สินค้านำเข้า (ผู้ดูแลระบบ)" : ""}
                  </option>
                );
              })}
            </select>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm">
              รวม <b className="tabular-nums">{formatTHB(total)}</b> (ก่อน VAT)
            </span>
            <Button type="submit" size="sm" disabled={save.isPending || missing}>
              บันทึกการซื้อ + รับเข้าสต๊อก
            </Button>
          </div>
        </div>
      </form>
      ) : null}

      <h2 className="mb-2 text-base font-semibold">ประวัติการซื้อ</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="ค้นหา SKU ผู้ขาย เลขบิล"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <CategoryFilter skus={skus ?? []} value={cat} onChange={setCat} />
        <select
          className="h-9 max-w-xs rounded-md border border-input bg-background px-2 text-sm"
          value={skuFilter}
          onChange={(e) => setSkuFilter(e.target.value)}
        >
          <option value="">ทุก SKU</option>
          {(skus ?? [])
            .filter((s) => latest.has(s.id))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
        </select>
      </div>

      {summary && filtSku ? (
        <div className="mb-3 grid gap-2 rounded-lg border border-border bg-card p-3 text-sm sm:grid-cols-5">
          <Stat label={`ต้นทุนล่าสุด (${filtSku.code})`} value={formatTHB(summary.last)} />
          <Stat
            label="เทียบครั้งก่อน"
            value={summary.change === null ? "—" : `${summary.change > 0 ? "▲" : summary.change < 0 ? "▼" : "="} ${Math.abs(summary.change)}%`}
          />
          <Stat label="ต่ำสุด / สูงสุด" value={`${formatTHB(summary.min)} / ${formatTHB(summary.max)}`} />
          <Stat label="เฉลี่ย (ถ่วงตามจำนวน)" value={formatTHB(summary.average)} />
          <Stat label="ซื้อทั้งหมด" value={`${summary.count} ครั้ง · ${formatQty(summary.qty)} ${filtSku.unit}`} />
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <Th>วันที่</Th>
              <Th>SKU</Th>
              <Th>จำนวน</Th>
              <Th>ราคา/หน่วย</Th>
              <Th>ค่าใช้จ่ายเพิ่ม</Th>
              <Th>ต้นทุน/หน่วย</Th>
              <Th>รวม</Th>
              <Th>ผู้ขาย</Th>
              <Th>เลขที่บิล</Th>
              <Th>โปรเจกต์</Th>
              {isAdmin ? <Th /> : null}
            </tr>
          </thead>
          <tbody>
            {purchasesQ.isLoading ? (
              <tr>
                <Td colSpan={11}>กำลังโหลด...</Td>
              </tr>
            ) : history.length ? (
              history.map((p) => {
                const s = skuById.get(p.sku_id);
                const cost = unitCost(p);
                const isLatest = latest.get(p.sku_id)?.id === p.id;
                return (
                  <tr key={p.id} className="border-t border-border">
                    <Td className="whitespace-nowrap">{formatDate(p.date)}</Td>
                    <Td>
                      <button
                        className="text-left hover:underline"
                        title="ดูประวัติของ SKU นี้"
                        onClick={() => setSkuFilter(p.sku_id)}
                      >
                        <span className="font-mono text-xs">{s?.code}</span> {s?.name}
                      </button>
                      {p.purchase_request_id ? <div className="text-xs text-muted-foreground">ตามใบขอซื้อ</div> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {formatQty(Number(p.qty))} {s?.unit}
                    </Td>
                    <Td className="text-right tabular-nums">{formatTHB(Number(p.unit_price))}</Td>
                    <Td className="text-right tabular-nums">{Number(p.extra_cost) ? formatTHB(Number(p.extra_cost)) : "—"}</Td>
                    <Td className="whitespace-nowrap text-right font-medium tabular-nums">
                      {formatTHB(cost)}
                      {isLatest ? (
                        <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">ใช้เป็นต้นทุน</span>
                      ) : null}
                    </Td>
                    <Td className="text-right tabular-nums">{formatTHB(cost * Number(p.qty))}</Td>
                    <Td>{p.supplier ?? "—"}</Td>
                    <Td>{p.doc_no ?? "—"}</Td>
                    <Td>{(p.projects as { code: string } | null)?.code ?? "—"}</Td>
                    {isAdmin ? (
                      <Td className="whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          แก้ไข
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm("ลบรายการซื้อนี้? ระบบจะหักสต๊อกคืนและคำนวณต้นทุนใหม่"))
                              remove.mutate(p.id);
                          }}
                        >
                          ลบ
                        </Button>
                      </Td>
                    ) : null}
                  </tr>
                );
              })
            ) : (
              <tr>
                <Td colSpan={11}>{missing ? "—" : "ยังไม่มีประวัติการซื้อ"}</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <EditPurchaseDialog
          purchase={editing}
          skus={skus ?? []}
          projects={projects ?? []}
          suppliers={suppliers}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

type Purchase = {
  id: string;
  date: string;
  sku_id: string;
  qty: number;
  unit_price: number;
  extra_cost: number;
  supplier: string | null;
  doc_no: string | null;
  note: string | null;
  project_id: string | null;
  purchase_request_id: string | null;
};

/** Admin fixes a recorded purchase; the database moves the stock difference and recalculates the cost. */
function EditPurchaseDialog({
  purchase: p,
  skus,
  projects,
  suppliers,
  onClose,
}: {
  purchase: Purchase;
  skus: { id: string; code: string; name: string; unit: string }[];
  projects: { id: string; code: string; name: string }[];
  suppliers: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    date: p.date,
    sku_id: p.sku_id,
    qty: String(Number(p.qty)),
    unit_price: String(Number(p.unit_price)),
    extra_cost: Number(p.extra_cost) ? String(Number(p.extra_cost)) : "",
    supplier: p.supplier ?? "",
    doc_no: p.doc_no ?? "",
    note: p.note ?? "",
    project_id: p.project_id ?? "",
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const unit = skus.find((s) => s.id === f.sku_id)?.unit;

  const save = useMutation({
    mutationFn: async () => {
      const qty = toNumber(f.qty);
      const price = toNumber(f.unit_price);
      if (!f.sku_id) throw new Error("เลือก SKU");
      if (!qty || qty <= 0) throw new Error("จำนวนต้องมากกว่า 0");
      if (price === null || price < 0) throw new Error("ใส่ราคาต่อหน่วย");
      const { data, error } = await supabase
        .from("purchases")
        .update({
          date: f.date || today(),
          sku_id: f.sku_id,
          qty,
          unit_price: price,
          extra_cost: toNumber(f.extra_cost) ?? 0,
          supplier: f.supplier.trim() || null,
          doc_no: f.doc_no.trim() || null,
          note: f.note.trim() || null,
          project_id: f.project_id || null,
        })
        .eq("id", p.id)
        .select("id");
      // without the update policy (docs/sql/purchases_edit.sql) the database refuses
      // or silently skips the row, so both cases get the same explanation
      const notReady =
        "ยังแก้ไขไม่ได้ — ฐานข้อมูลยังไม่เปิดให้แก้ไขรายการซื้อ (ให้ Lovable รันไฟล์ docs/sql/purchases_edit.sql) หรือบัญชีนี้ไม่ใช่ผู้ดูแลระบบ";
      if (error) throw new Error(/permission denied/i.test(error.message) ? notReady : error.message);
      if (!data?.length) throw new Error(notReady);
    },
    onSuccess: () => {
      toast.success("แก้ไขแล้ว — ปรับสต๊อกและคำนวณต้นทุนใหม่");
      ["purchases", "sku_on_hand", "stock_movements", "sku_costs", "material_demand"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>แก้ไขรายการซื้อ</DialogTitle>
        </DialogHeader>
        <form
          id="edit-purchase"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="SKU" className="sm:col-span-2">
            <select
              className={sel}
              value={f.sku_id}
              disabled={!!p.purchase_request_id}
              onChange={(e) => set({ sku_id: e.target.value })}
            >
              {skus.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.code} — {k.name}
                </option>
              ))}
            </select>
            {p.purchase_request_id ? (
              <div className="text-xs text-muted-foreground">รับของตามใบขอซื้อ — เปลี่ยน SKU ไม่ได้</div>
            ) : null}
          </Field>
          <Field label={`จำนวน${unit ? ` (${unit})` : ""}`}>
            <Input inputMode="decimal" value={f.qty} onChange={(e) => set({ qty: e.target.value })} />
          </Field>
          <Field label="ราคา/หน่วย (ก่อน VAT)">
            <Input inputMode="decimal" value={f.unit_price} onChange={(e) => set({ unit_price: e.target.value })} />
          </Field>
          <Field label="ค่าใช้จ่ายเพิ่ม (รวม)">
            <Input
              inputMode="decimal"
              value={f.extra_cost}
              placeholder="0"
              onChange={(e) => set({ extra_cost: e.target.value })}
            />
          </Field>
          <Field label="วันที่ซื้อ">
            <Input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="ผู้ขาย / ร้าน">
            <Input list="suppliers-edit" value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} />
            <datalist id="suppliers-edit">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="เลขที่บิล / ใบกำกับ">
            <Input value={f.doc_no} onChange={(e) => set({ doc_no: e.target.value })} />
          </Field>
          <Field label="โปรเจกต์">
            <select className={sel} value={f.project_id} onChange={(e) => set({ project_id: e.target.value })}>
              <option value="">— สต๊อกกลาง —</option>
              {projects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="หมายเหตุ">
            <Input value={f.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        </form>
        <p className="text-xs text-muted-foreground">
          ถ้าเปลี่ยนจำนวน SKU หรือโปรเจกต์ ระบบจะปรับสต๊อกส่วนต่างให้ และคำนวณต้นทุนล่าสุดใหม่
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" form="edit-purchase" disabled={save.isPending}>
            บันทึกการแก้ไข
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
