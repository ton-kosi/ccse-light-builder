import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/routes/_authenticated/customers";
import { useMe } from "@/hooks/useMe";
import { CLAUSE_SECTIONS, type ClauseSection } from "@/lib/clauses";
import { toNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clauses")({
  head: () => ({
    meta: [
      { title: "หมายเหตุและประกัน | CCSE ERP" },
      { name: "description", content: "ชุดข้อความหมายเหตุและประกันที่ผูกกับชิ้นส่วนขาย" },
      { property: "og:title", content: "หมายเหตุและประกัน | CCSE ERP" },
      { property: "og:description", content: "ชุดข้อความท้ายใบเสนอราคา" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClausesPage,
});

const EMPTY = {
  section: "warranty" as ClauseSection,
  text: "",
  sort_order: "",
  always_include: false,
};

function ClausesPage() {
  const { has } = useMe();
  const canEdit = has("admin", "estimator");
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [linking, setLinking] = useState<{ id: string; text: string } | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const { data: clauses, isLoading } = useQuery({
    queryKey: ["quote_clauses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_clauses")
        .select("*")
        .order("sort_order")
        .order("text");
      if (error) throw error;
      return data;
    },
  });
  const { data: links } = useQuery({
    queryKey: ["component_clauses", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_clauses")
        .select("clause_id, component_id, sales_components(code)");
      if (error) throw error;
      return data;
    },
  });
  const codesByClause = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links ?? []) {
      const code = (l.sales_components as { code: string } | null)?.code ?? "?";
      m.set(l.clause_id, [...(m.get(l.clause_id) ?? []), code]);
    }
    return m;
  }, [links]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quote_clauses"] });
    qc.invalidateQueries({ queryKey: ["component_clauses"] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: async () => {
      const sameSection = (clauses ?? []).filter((c) => c.section === form.section);
      const { error } = await supabase.from("quote_clauses").insert({
        section: form.section,
        text: form.text.trim(),
        sort_order:
          toNumber(form.sort_order) ?? Math.max(0, ...sameSection.map((c) => c.sort_order)) + 10,
        always_include: form.always_include,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มข้อความแล้ว");
      setForm({ ...EMPTY, section: form.section });
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"quote_clauses"> }) => {
      const { error } = await supabase.from("quote_clauses").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quote_clauses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ลบข้อความแล้ว");
      refresh();
    },
    onError,
  });

  const visible = (clauses ?? []).filter((c) => showInactive || c.active);

  return (
    <div>
      <PageHeader
        title="หมายเหตุและประกัน"
        description="พิมพ์ข้อความเตรียมไว้ครั้งเดียว แล้วผูกกับชิ้นส่วนขาย — ใบเสนอราคาที่มีชิ้นส่วนนั้นจะดึงข้อความไปให้อัตโนมัติ"
      />

      {canEdit ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.text.trim()) {
              toast.error("กรุณาพิมพ์ข้อความ");
              return;
            }
            add.mutate();
          }}
        >
          <Field label="หมวด">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={form.section}
              onChange={(e) => setForm({ ...form, section: e.target.value as ClauseSection })}
            >
              {CLAUSE_SECTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ข้อความ (ไม่ต้องพิมพ์ขีด - นำหน้า)" className="md:col-span-3">
            <Textarea
              rows={2}
              value={form.text}
              placeholder='เช่น LED "NICHIA CHIP" = 2 YEARS , LED "STANDARD CHIP" = 1 YEAR.'
              onChange={(e) => setForm({ ...form, text: e.target.value })}
            />
          </Field>
          <Field label="ลำดับ (ว่าง = ต่อท้าย)">
            <Input
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
            />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.always_include}
                onCheckedChange={(v) => setForm({ ...form, always_include: v === true })}
              />
              ทุกใบเสนอราคา
            </label>
            <Button size="sm" type="submit" disabled={add.isPending}>
              เพิ่มข้อความ
            </Button>
          </div>
        </form>
      ) : null}

      <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(v === true)} />
        แสดงข้อความที่ปิดใช้งานด้วย
      </label>

      {isLoading ? <p className="text-sm text-muted-foreground">กำลังโหลด...</p> : null}

      <div className="space-y-5">
        {CLAUSE_SECTIONS.map((s) => {
          const rows = visible.filter((c) => c.section === s.value);
          return (
            <section key={s.value} className="rounded-lg border border-border bg-card">
              <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">
                {s.heading}{" "}
                <span className="font-normal text-muted-foreground">({rows.length})</span>
              </h2>
              {rows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">ยังไม่มีข้อความในหมวดนี้</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="w-16 px-3 py-2 font-medium">ลำดับ</th>
                      <th className="px-3 py-2 font-medium">ข้อความ</th>
                      <th className="w-28 px-3 py-2 font-medium">ทุกใบ</th>
                      <th className="w-56 px-3 py-2 font-medium">ผูกกับชิ้นส่วน</th>
                      <th className="w-24 px-3 py-2 font-medium">ใช้งาน</th>
                      {canEdit ? <th className="w-16 px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const codes = codesByClause.get(c.id) ?? [];
                      return (
                        <tr
                          key={c.id}
                          className={
                            "border-t border-border align-top " + (c.active ? "" : "opacity-50")
                          }
                        >
                          <td className="px-3 py-2">
                            <Input
                              className="h-8 w-14"
                              defaultValue={String(c.sort_order)}
                              disabled={!canEdit}
                              onBlur={(e) => {
                                const n = toNumber(e.target.value);
                                if (n !== null && n !== c.sort_order)
                                  update.mutate({ id: c.id, patch: { sort_order: Math.round(n) } });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Textarea
                              rows={Math.min(4, Math.max(1, Math.ceil(c.text.length / 90)))}
                              className="min-h-8"
                              defaultValue={c.text}
                              disabled={!canEdit}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== c.text)
                                  update.mutate({ id: c.id, patch: { text: v } });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={c.always_include}
                              disabled={!canEdit}
                              onCheckedChange={(v) =>
                                update.mutate({ id: c.id, patch: { always_include: v === true } })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {c.always_include ? (
                                <span className="text-xs text-muted-foreground">ทุกใบเสนอราคา</span>
                              ) : codes.length ? (
                                <span className="text-xs">
                                  {codes.slice(0, 4).join(", ")}
                                  {codes.length > 4 ? ` +${codes.length - 4}` : ""}
                                </span>
                              ) : (
                                <span className="text-xs text-warning">ยังไม่ผูก</span>
                              )}
                              {canEdit ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  onClick={() => setLinking({ id: c.id, text: c.text })}
                                >
                                  เลือก
                                </Button>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={c.active}
                              disabled={!canEdit}
                              onCheckedChange={(v) =>
                                update.mutate({ id: c.id, patch: { active: v === true } })
                              }
                            />
                          </td>
                          {canEdit ? (
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "ลบข้อความนี้? ใบเสนอราคาที่ใช้ไปแล้วจะยังเก็บข้อความเดิมไว้",
                                    )
                                  )
                                    remove.mutate(c.id);
                                }}
                              >
                                ลบ
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>

      {linking ? <LinkComponentsDialog clause={linking} onClose={() => setLinking(null)} /> : null}
    </div>
  );
}

function LinkComponentsDialog({
  clause,
  onClose,
}: {
  clause: { id: string; text: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const { data: comps } = useQuery({
    queryKey: ["sales_components", "clause-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_components")
        .select("id, code, name")
        .order("code");
      if (error) throw error;
      return data;
    },
  });
  const { data: linked } = useQuery({
    queryKey: ["component_clauses", "clause", clause.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_clauses")
        .select("component_id")
        .eq("clause_id", clause.id);
      if (error) throw error;
      return new Set(data.map((d) => d.component_id));
    },
  });
  const toggle = useMutation({
    mutationFn: async ({ componentId, on }: { componentId: string; on: boolean }) => {
      const { error } = on
        ? await supabase
            .from("component_clauses")
            .insert({ component_id: componentId, clause_id: clause.id })
        : await supabase
            .from("component_clauses")
            .delete()
            .eq("component_id", componentId)
            .eq("clause_id", clause.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["component_clauses"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const needle = q.trim().toLowerCase();
  const list = (comps ?? []).filter(
    (c) =>
      !needle || c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ผูกข้อความกับชิ้นส่วนขาย</DialogTitle>
        </DialogHeader>
        <p className="rounded bg-secondary px-3 py-2 text-sm">- {clause.text}</p>
        <Input
          placeholder="ค้นหารหัสหรือชื่อชิ้นส่วน"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="divide-y divide-border rounded border border-border">
          {list.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-secondary/50"
            >
              <Checkbox
                className="mt-0.5"
                checked={linked?.has(c.id) ?? false}
                onCheckedChange={(v) => toggle.mutate({ componentId: c.id, on: v === true })}
              />
              <span>
                <span className="font-medium">{c.code}</span>
                <span className="block whitespace-pre-line text-xs text-muted-foreground">
                  {c.name}
                </span>
              </span>
            </label>
          ))}
          {list.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">ไม่พบชิ้นส่วน</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
