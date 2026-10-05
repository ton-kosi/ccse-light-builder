import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { RollPlanSection } from "@/components/work/RollPlanSection";
import { formatCutLengths } from "@/lib/boq";
import { RELEASE_MIN_STATUS, statusLabel } from "@/lib/erp";
import { formatDate, formatQty } from "@/lib/format";

/** Price-free work sheet. Reads only from wo_* database functions (no price columns). */
export function useWorkSheet(projectId: string) {
  const project = useQuery({
    queryKey: ["project", projectId, "wo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, code, name, status, selected_option, site_address, install_days_min, install_days_max, customers(name)")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const header = useQuery({
    queryKey: ["wo_header", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wo_header", { _project_id: projectId });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const lines = useQuery({
    queryKey: ["wo_lines", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wo_lines", { _project_id: projectId });
      if (error) throw error;
      return data ?? [];
    },
  });
  const pick = useQuery({
    queryKey: ["wo_pick_list", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wo_pick_list", { _project_id: projectId });
      if (error) throw error;
      return data ?? [];
    },
  });
  return { project: project.data, header: header.data, lines: lines.data ?? [], pick: pick.data ?? [], isLoading: project.isLoading };
}

type WoLine = ReturnType<typeof useWorkSheet>["lines"][number];

export function WorkSheet({ projectId, print = false }: { projectId: string; print?: boolean }) {
  const { project, header, lines, pick, isLoading } = useWorkSheet(projectId);
  const { has } = useMe();
  const qc = useQueryClient();

  const confirm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("confirm_material_issue", { _project_id: projectId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ยืนยันเบิกของแล้ว — สถานะเปลี่ยนเป็น 7 ผลิต");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;
  if (!project) return <p className="text-sm text-muted-foreground">ไม่พบโปรเจกต์</p>;

  const notReleased = project.status < RELEASE_MIN_STATUS;
  const site = lines.filter((l) => l.kind === "by_buyer" || l.kind === "existing");
  const prod = lines.filter((l) => l.kind !== "by_buyer" && l.kind !== "existing");

  // group by heading
  const groups: { heading: WoLine | null; rows: WoLine[] }[] = [];
  for (const l of prod) {
    if (l.kind === "heading") groups.push({ heading: l, rows: [] });
    else {
      if (!groups.length) groups.push({ heading: null, rows: [] });
      groups[groups.length - 1]!.rows.push(l);
    }
  }

  const byCat = new Map<string, number>();
  for (const l of prod) {
    if (l.kind === "heading" || !l.install_category) continue;
    byCat.set(l.install_category, (byCat.get(l.install_category) ?? 0) + Number(l.qty ?? 0));
  }

  const canConfirm = has("stock", "admin") && project.status === 6 && !header?.issued_at;
  const name = (l: WoLine) => l.component_name ?? l.heading_text ?? "—";
  const sec = "mt-5 break-inside-avoid";
  const th = "border border-border px-2 py-1 text-left text-xs font-semibold";
  const td = "border border-border px-2 py-1 align-top";

  return (
    <div className={print ? "text-[12px]" : "space-y-2 text-sm"}>
      {notReleased ? (
        <div className="rounded-md border-2 border-destructive bg-destructive px-4 py-3 text-center text-lg font-bold text-destructive-foreground">
          ยังไม่ได้รับมัดจำ – ห้ามปล่อยใบนี้
        </div>
      ) : null}

      <div className="mt-3 grid gap-x-6 gap-y-1 rounded-md border border-border p-3 sm:grid-cols-3">
        <div><span className="text-muted-foreground">โปรเจกต์: </span><b>{project.code}</b> — {project.name}</div>
        <div><span className="text-muted-foreground">ลูกค้า: </span>{(project.customers as { name: string } | null)?.name ?? "-"}</div>
        <div><span className="text-muted-foreground">สถานะ: </span>{project.status}. {statusLabel(project.status)}</div>
        <div><span className="text-muted-foreground">ใบเสนอราคา: </span>{header?.ref_no ?? "-"} Rev {header?.rev ?? "-"}</div>
        <div><span className="text-muted-foreground">Option ที่เลือก: </span>{project.selected_option || "-"}</div>
        <div><span className="text-muted-foreground">วันติดตั้ง: </span>{project.install_days_min ?? "-"}–{project.install_days_max ?? "-"} วัน</div>
        {project.site_address ? <div className="sm:col-span-3"><span className="text-muted-foreground">สถานที่: </span>{project.site_address}</div> : null}
      </div>

      {!print ? (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/print/work/$projectId" params={{ projectId }} target="_blank">พิมพ์ใบ Work (A4)</Link>
          </Button>
          {has("stock", "admin") ? (
            <Button
              size="sm"
              disabled={!canConfirm || confirm.isPending}
              onClick={() => {
                if (confirm.isPending) return;
                if (window.confirm(`ยืนยันเบิกของ ${pick.length} รายการ ตาม Rev ${header?.rev ?? ""}?`)) confirm.mutate();
              }}
            >
              ยืนยันเบิกของ
            </Button>
          ) : null}
          {header?.issued_at ? (
            <span className="text-xs text-muted-foreground">เบิกของ Rev {header.rev} แล้วเมื่อ {formatDate(header.issued_at)}</span>
          ) : project.status !== 6 && has("stock", "admin") ? (
            <span className="text-xs text-muted-foreground">ยืนยันเบิกของได้เมื่อสถานะ = 6 เท่านั้น</span>
          ) : null}
        </div>
      ) : null}

      <section className={sec}>
        <h3 className="mb-1 font-semibold">1. รายการผลิต</h3>
        <table className="w-full border-collapse">
          <thead className="bg-muted">
            <tr>
              <th className={th}>ITEM</th><th className={th}>ชิ้นส่วน</th><th className={th}>วงจร</th>
              <th className={th}>ตัดเส้น</th><th className={th + " text-right"}>จำนวน</th><th className={th}>หน่วย</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => (
              <Fragment key={g.heading?.id ?? `g${gi}`}>
                {g.heading ? (
                  <tr className="bg-secondary font-semibold">
                    <td className={td}>{g.heading.item_no}</td>
                    <td className={td} colSpan={5}>{name(g.heading)}{g.heading.circuit_note ? ` · ${g.heading.circuit_note}` : ""}</td>
                  </tr>
                ) : null}
                {g.rows.map((l) => (
                  <tr key={l.id}>
                    <td className={td}>{l.item_no}</td>
                    <td className={td}>{name(l)}{l.component_code ? <span className="text-muted-foreground"> ({l.component_code})</span> : null}</td>
                    <td className={td}>{l.circuit_note}</td>
                    <td className={td}>{formatCutLengths(l.cut_lengths)}</td>
                    <td className={td + " text-right tabular-nums"}>{formatQty(Number(l.qty ?? 0))}</td>
                    <td className={td}>{l.unit}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {prod.length === 0 ? <tr><td className={td} colSpan={6}>ไม่มีรายการ</td></tr> : null}
          </tbody>
        </table>

        {site.length ? (
          <>
            <h4 className="mt-3 mb-1 font-semibold">สิ่งที่หน้างานต้องเตรียม</h4>
            <table className="w-full border-collapse">
              <tbody>
                {site.map((l) => (
                  <tr key={l.id} className="italic">
                    <td className={td + " w-16"}>{l.item_no}</td>
                    <td className={td}>{name(l)}</td>
                    <td className={td + " w-24"}>{l.kind === "by_buyer" ? "by buyer" : "existing"}</td>
                    <td className={td + " w-24 text-right"}>{l.qty != null ? `${formatQty(Number(l.qty))} ${l.unit ?? ""}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      <RollPlanSection projectId={projectId} print={print} />


      <section className={sec}>
        <h3 className="mb-1 font-semibold">2. รายการเบิกของ (Pick list)</h3>
        <table className="w-full border-collapse">
          <thead className="bg-muted">
            <tr>
              <th className={th}>รหัส SKU</th><th className={th}>ชื่อ</th><th className={th + " text-right"}>จำนวน</th>
              <th className={th}>หน่วย</th><th className={th + " text-right"}>คงเหลือในคลัง</th>
              {print ? <th className={th}>เบิกจริง</th> : null}
            </tr>
          </thead>
          <tbody>
            {pick.map((p) => {
              const short = Number(p.on_hand) < Number(p.qty);
              return (
                <tr key={p.sku_id}>
                  <td className={td + " font-mono"}>{p.code}</td>
                  <td className={td}>{p.name}</td>
                  <td className={td + " text-right tabular-nums font-semibold"}>{formatQty(Number(p.qty))}</td>
                  <td className={td}>{p.unit}</td>
                  <td className={td + " text-right tabular-nums " + (short ? "font-semibold text-destructive" : "")}>{formatQty(Number(p.on_hand))}</td>
                  {print ? <td className={td + " w-20"} /> : null}
                </tr>
              );
            })}
            {pick.length === 0 ? <tr><td className={td} colSpan={6}>ไม่มีรายการ</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className={sec}>
        <h3 className="mb-1 font-semibold">3. สรุปงานติดตั้ง</h3>
        <table className="w-full max-w-md border-collapse">
          <tbody>
            {[...byCat.entries()].map(([cat, q]) => (
              <tr key={cat}>
                <td className={td}>{cat}</td>
                <td className={td + " text-right tabular-nums font-semibold"}>{formatQty(q)}</td>
              </tr>
            ))}
            {byCat.size === 0 ? <tr><td className={td} colSpan={2}>ไม่มีข้อมูลหมวดติดตั้ง</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
