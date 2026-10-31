import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { qrSvg } from "@/components/scan/QrCode";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { formatDate, formatQty, toNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/remnants")({
  head: () => ({
    meta: [
      { title: "เศษม้วน | CCSE ERP" },
      { name: "description", content: "ติดตามเศษม้วนที่ยังใช้ได้ในคลัง พิมพ์ป้าย และรายงานเมตรที่ประหยัดได้" },
      { property: "og:title", content: "เศษม้วน | CCSE ERP" },
      { property: "og:description", content: "ติดตามเศษม้วนที่ยังใช้ได้ในคลัง CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RemnantsPage,
});

const STATUS: Record<string, string> = {
  available: "พร้อมใช้",
  reserved: "จองแล้ว",
  used: "ใช้แล้ว",
  scrapped: "ทิ้ง",
};

type Rem = {
  id: string; code: string; length_m: number; status: string; created_at: string; note: string | null;
  used_m: number | null; used_at: string | null;
  skus: { code: string; name: string; roll_family: string | null } | null;
  src: { code: string } | null; res: { code: string } | null;
};

function RemnantsPage() {
  const { canEditMaster } = useMe();
  const qc = useQueryClient();
  const [family, setFamily] = useState("");
  const [status, setStatus] = useState("available");

  const { data: rems } = useQuery({
    queryKey: ["remnants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("remnants")
        .select("id, code, length_m, status, created_at, note, used_m, used_at, skus(code, name, roll_family), src:projects!remnants_source_project_id_fkey(code), res:projects!remnants_reserved_project_id_fkey(code)")
        .order("code", { ascending: false });
      if (error) throw error;
      return data as unknown as Rem[];
    },
  });
  const { data: rollSkus } = useQuery({
    queryKey: ["skus", "rolls"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, code, name, roll_family").eq("is_roll", true).order("code");
      if (error) throw error;
      return data;
    },
  });

  const scrap = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("remnants").update({ status: "scrapped", reserved_project_id: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("ทำเครื่องหมายทิ้งแล้ว"); qc.invalidateQueries({ queryKey: ["remnants"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = rems ?? [];
  const families = Array.from(new Set(all.map((r) => r.skus?.roll_family).filter(Boolean))) as string[];
  const list = all.filter((r) => (!family || r.skus?.roll_family === family) && (!status || r.status === status));

  // meters saved per month
  const saved = new Map<string, number>();
  for (const r of all) {
    if (r.status !== "used" || !r.used_at || !r.used_m) continue;
    const d = new Date(r.used_at);
    const k = `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    saved.set(k, (saved.get(k) ?? 0) + Number(r.used_m));
  }
  const savedRows = [...saved.entries()].sort((a, b) => {
    const [ma, ya] = a[0].split("/"); const [mb, yb] = b[0].split("/");
    return Number(yb) - Number(ya) || Number(mb) - Number(ma);
  });

  const printLabel = async (r: Rem) => {
    // open first (inside the click) so the browser does not block the window, then fill it
    const w = window.open("", "_blank", "width=420,height=320");
    if (!w) return;
    const qr = await qrSvg(r.code).catch(() => "");
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    w.document.write(`<html><head><title>${esc(r.code)}</title><style>
      @page{size:80mm 50mm;margin:3mm} body{font-family:'Noto Sans Thai',sans-serif;margin:0}
      .l{border:2px solid #000;padding:8px;width:72mm;height:42mm;box-sizing:border-box;display:flex;gap:8px;align-items:center}
      .q{width:30mm;height:30mm;flex:none} .q svg{width:100%;height:100%}
      .c{font-size:28px;font-weight:700} .s{font-size:13px} .m{font-size:22px;font-weight:700}
      </style></head><body><div class="l"><div class="q">${qr}</div><div><div class="c">${esc(r.code)}</div>
      <div class="s">${esc(r.skus?.code ?? "")}<br/>${esc(r.skus?.name ?? "")}</div>
      <div class="m">${formatQty(Number(r.length_m))} ม.</div>
      <div class="s">${formatDate(r.created_at)}</div></div></div>
      <script>window.onload=()=>{window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="เศษม้วน" description="เศษจากการตัดม้วนที่ยาวตั้งแต่ค่าขั้นต่ำในหน้าตั้งค่าขึ้นไป" />

      <div className="flex flex-wrap gap-3">
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={family} onChange={(e) => setFamily(e.target.value)}>
          <option value="">ทุกตระกูลม้วน</option>
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr><Th>รหัส</Th><Th>SKU</Th><Th>ตระกูล</Th><Th>ยาว (ม.)</Th><Th>สถานะ</Th><Th>จากงาน</Th><Th>จองให้งาน</Th><Th>วันที่</Th><Th>{""}</Th></tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td className="font-mono font-semibold">{r.code}</Td>
                <Td>{r.skus?.code} <span className="text-muted-foreground">{r.skus?.name}</span></Td>
                <Td>{r.skus?.roll_family ?? "-"}</Td>
                <Td className="text-right tabular-nums">{formatQty(Number(r.length_m))}</Td>
                <Td>{STATUS[r.status] ?? r.status}</Td>
                <Td>{r.src?.code ?? "-"}</Td>
                <Td>{r.res?.code ?? "-"}</Td>
                <Td>{formatDate(r.created_at)}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => printLabel(r)}>พิมพ์ป้าย</Button>{" "}
                  {canEditMaster && (r.status === "available" || r.status === "reserved") ? (
                    <Button size="sm" variant="ghost" className="text-destructive"
                      onClick={() => window.confirm(`ทำเครื่องหมาย ${r.code} ว่าทิ้งแล้ว?`) && scrap.mutate(r.id)}>
                      ทิ้ง
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
            {list.length === 0 ? <tr><Td colSpan={9}>ไม่มีเศษม้วน</Td></tr> : null}
          </tbody>
        </table>
      </div>

      {canEditMaster ? <AddRemnant skus={rollSkus ?? []} /> : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">รายงาน: เมตรที่ประหยัดได้จากการใช้เศษม้วน (ต่อเดือน)</h2>
        <table className="mt-2 w-full max-w-sm text-sm">
          <thead className="bg-muted"><tr><Th>เดือน</Th><Th>เมตร</Th></tr></thead>
          <tbody>
            {savedRows.map(([m, v]) => (
              <tr key={m} className="border-t border-border"><Td>{m}</Td><Td className="text-right tabular-nums font-semibold">{formatQty(v)}</Td></tr>
            ))}
            {savedRows.length === 0 ? <tr><Td colSpan={2}>ยังไม่มีการใช้เศษม้วน</Td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AddRemnant({ skus }: { skus: { id: string; code: string; name: string }[] }) {
  const qc = useQueryClient();
  const [skuId, setSkuId] = useState("");
  const [len, setLen] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const n = toNumber(len);
      if (!skuId) throw new Error("กรุณาเลือก SKU");
      if (n === null || n <= 0) throw new Error("ความยาวต้องมากกว่า 0");
      const { error } = await supabase.from("remnants").insert({ sku_id: skuId, length_m: n, note: "เพิ่มด้วยมือ" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("เพิ่มเศษม้วนแล้ว"); setLen(""); qc.invalidateQueries({ queryKey: ["remnants"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Field label="SKU ม้วน" className="sm:col-span-2">
        <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
          <option value="">— เลือก —</option>
          {skus.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
      </Field>
      <Field label="ยาว (ม.)"><Input value={len} onChange={(e) => setLen(e.target.value)} inputMode="decimal" /></Field>
      <div className="flex items-end"><Button type="submit" disabled={add.isPending}>เพิ่มเศษม้วน</Button></div>
    </form>
  );
}
