import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkSheet } from "@/components/work/WorkSheet";
import { useProduction } from "@/hooks/useProduction";
import { useMe } from "@/hooks/useMe";
import { formatQty, toNumber } from "@/lib/format";
import { materialSummary, nextRound, type Move, type SkuInfo } from "@/lib/materials";

export const materialMovesKey = (projectId: string) => ["material_moves", projectId];

/** Everything the ใบเบิกของ / ใบคืนของ needs for a project (no prices). */
export function useMaterialSummary(projectId: string) {
  const { header, pick, isLoading } = useWorkSheet(projectId);
  const { lines: prod } = useProduction(projectId);

  const data = useQuery({
    queryKey: [...materialMovesKey(projectId), pick.map((p) => p.sku_id).join(",")],
    queryFn: async () => {
      const [first, moves] = await Promise.all([
        supabase
          .from("stock_movements")
          .select("sku_id, qty")
          .eq("project_id", projectId)
          .eq("type", "issue")
          .like("note", "เบิกตามใบ Work%"),
        supabase.from("material_moves").select("kind, round_no, sku_id, qty, note, created_at").eq("project_id", projectId).order("created_at"),
      ]);
      if (first.error) throw first.error;
      // before migration 0017 there are no extra rounds / returns yet
      if (moves.error && !/does not exist|schema cache/i.test(moves.error.message)) throw moves.error;
      const movesRows = moves.error ? [] : (moves.data ?? []);
      const known = new Set(pick.map((p) => p.sku_id));
      const missing = [...new Set([...(first.data ?? []), ...movesRows].map((r) => r.sku_id))].filter((id) => !known.has(id));
      const extra = missing.length
        ? ((await supabase.from("skus").select("id, code, name, unit").in("id", missing)).data ?? [])
        : [];
      return {
        firstIssue: (first.data ?? []).map((r) => ({ sku_id: r.sku_id, qty: -Number(r.qty) })),
        moves: movesRows as (Move & { note: string | null; created_at: string })[],
        extra: extra as SkuInfo[],
      };
    },
  });

  const skus = new Map<string, SkuInfo>();
  for (const p of pick) skus.set(p.sku_id, { id: p.sku_id, code: p.code, name: p.name, unit: p.unit });
  for (const s of data.data?.extra ?? []) skus.set(s.id, s);
  // หน้างาน: actual LED / profile metres from the production sheet
  const site = new Map<string, number>();
  for (const l of prod) {
    site.set(l.led.id, (site.get(l.led.id) ?? 0) + l.totals.ledM);
    if (l.profile) site.set(l.profile.id, (site.get(l.profile.id) ?? 0) + l.totals.profileM);
  }
  const summary = materialSummary({
    skus,
    demand: pick.map((p) => ({ sku_id: p.sku_id, qty: Number(p.qty) })),
    firstIssue: data.data?.firstIssue ?? [],
    moves: data.data?.moves ?? [],
    site,
  });
  return {
    ...summary,
    moves: data.data?.moves ?? [],
    issuedAt: header?.issued_at ?? null,
    rev: header?.rev ?? null,
    isLoading: isLoading || data.isLoading,
  };
}

/** ใบเบิกของ: WOS vs site vs each issue round vs returns, plus extra issue / return for the store. */
export function MaterialSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { has } = useMe();
  const canMove = has("admin", "stock");
  const { rows, roundCount, moves, issuedAt, rev, isLoading } = useMaterialSummary(projectId);
  const { data: allSkus } = useQuery({
    queryKey: ["skus", "options"],
    enabled: canMove && !!issuedAt,
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, code, name, unit").order("code");
      if (error) throw error;
      return data;
    },
  });
  const next = nextRound(moves);
  const extraRounds = [...new Set(moves.filter((m) => m.kind === "issue").map((m) => m.round_no!))].sort((a, b) => a - b);
  const [f, setF] = useState({ kind: "issue" as "issue" | "return", round: 0, sku: "", qty: "", note: "" });
  const round = f.round || next;

  const add = useMutation({
    mutationFn: async () => {
      const qty = toNumber(f.qty);
      if (!f.sku) throw new Error("เลือกสินค้า");
      if (!qty || qty <= 0) throw new Error("จำนวนต้องมากกว่า 0");
      const { error } = await supabase.from("material_moves").insert({
        project_id: projectId,
        kind: f.kind,
        round_no: f.kind === "issue" ? round : null,
        sku_id: f.sku,
        qty,
        note: f.note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(f.kind === "issue" ? `บันทึกเบิกเพิ่มครั้งที่ ${round}` : "บันทึกคืนของแล้ว — รับเข้าสต๊อก");
      setF({ ...f, sku: "", qty: "", note: "", round: f.kind === "issue" ? round : 0 });
      ["material_moves", "sku_on_hand", "stock_movements", "wo_pick_list", "material_demand"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) =>
      toast.error(
        /material_moves|schema cache/i.test(e.message)
          ? "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/material_moves.sql ก่อน"
          : e.message,
      ),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด…</p>;
  const th = "border border-border px-1.5 py-1 text-left font-semibold whitespace-normal";
  const td = "border border-border px-1.5 py-0.5 tabular-nums";
  const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  const options = f.kind === "return" ? rows.filter((r) => r.used > 0).map((r) => r.sku) : (allSkus ?? []);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {issuedAt
            ? `เบิกครั้งที่ 1 ตาม Rev ${rev ?? ""} แล้ว — เบิกเพิ่ม / คืนของได้ที่ด้านล่าง`
            : "ยังไม่ได้ยืนยันเบิกของครั้งที่ 1 (ปุ่ม “ยืนยันเบิกของ” ด้านบน เมื่อสถานะ = 6)"}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/print/materials/$projectId" params={{ projectId }} target="_blank">
            พิมพ์ใบเบิกของ / ใบคืนของ
          </Link>
        </Button>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse whitespace-nowrap text-xs">
            <thead className="bg-muted">
              <tr>
                <th className={th}>รายการเบิก</th>
                <th className={th + " text-right"}>ใบงาน</th>
                <th className={th + " text-right"}>หน้างาน</th>
                {Array.from({ length: roundCount }, (_, i) => (
                  <th key={i} className={th + " text-right"}>
                    เบิกครั้งที่ {i + 1}
                  </th>
                ))}
                <th className={th + " text-right"}>เบิกรวม</th>
                <th className={th + " text-right"}>คืนของ</th>
                <th className={th + " text-right"}>ใช้จริง</th>
                <th className={th}>หน่วย</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku.id}>
                  <td className={td + " whitespace-normal"}>
                    <span className="font-mono text-[10px] text-muted-foreground">{r.sku.code}</span> {r.sku.name}
                  </td>
                  <td className={td + " text-right"}>{formatQty(r.wos)}</td>
                  <td className={td + " text-right"}>{r.site !== null ? formatQty(r.site) : ""}</td>
                  {r.rounds.map((q, i) => (
                    <td key={i} className={td + " text-right"}>
                      {q ? formatQty(q) : ""}
                    </td>
                  ))}
                  <td className={td + " text-right font-semibold"}>{formatQty(r.issued)}</td>
                  <td className={td + " text-right"}>{r.returned ? formatQty(r.returned) : ""}</td>
                  <td className={td + " text-right font-semibold " + (r.overWos > 0.0005 ? "text-warning" : "")}>
                    {formatQty(r.used)}
                  </td>
                  <td className={td}>{r.sku.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">ยังไม่มีรายการของที่ต้องเบิก</p>
      )}

      {canMove && issuedAt ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <select className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "issue" | "return", sku: "" })}>
            <option value="issue">เบิกเพิ่ม</option>
            <option value="return">คืนของ</option>
          </select>
          {f.kind === "issue" ? (
            <select className={sel} value={round} onChange={(e) => setF({ ...f, round: Number(e.target.value) })}>
              {extraRounds.map((n) => (
                <option key={n} value={n}>
                  ครั้งที่ {n}
                </option>
              ))}
              {!extraRounds.includes(next) ? <option value={next}>ครั้งที่ {next} (ใหม่)</option> : null}
            </select>
          ) : null}
          <select className={sel + " min-w-0 flex-1"} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })}>
            <option value="">— เลือกสินค้า —</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          <Input className="w-24" inputMode="decimal" placeholder="จำนวน" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <Input className="w-40" placeholder="หมายเหตุ" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <Button size="sm" type="submit" disabled={add.isPending}>
            บันทึก
          </Button>
        </form>
      ) : null}
    </div>
  );
}
