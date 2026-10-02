import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddRecipeItem } from "@/components/AddRecipeItem";
import { CsvImport, boolCsv, numCsv } from "@/components/CsvImport";
import { useMe } from "@/hooks/useMe";
import { formatQty, toNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/components")({
  head: () => ({
    meta: [
      { title: "ชิ้นส่วนขายและสูตร | CCSE ERP" },
      { name: "description", content: "ชื่อชิ้นส่วนที่ใช้ในใบเสนอราคา พร้อมสูตรแปลงเป็น SKU ในคลัง" },
      { property: "og:title", content: "ชิ้นส่วนขายและสูตร | CCSE ERP" },
      { property: "og:description", content: "ชิ้นส่วนขายและสูตร SKU ของ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComponentsPage,
});

export const INSTALL_CATEGORIES = [
  "ไฟเส้น (ม.)",
  "Driver/PSU (ตัว)",
  "Dimmer/Control (ชุด)",
  "Fiber optic (จุด)",
  "Fiber light source (เครื่อง)",
  "ผ้า Clipso (ชุด)",
  "โคม/อุปกรณ์ (ชุด)",
];

type Comp = Tables<"sales_components">;
const EMPTY = { code: "", name: "", unit: "ม.", install_category: "", is_roll_product: false, roll_family: "", notes: "" };
type Form = typeof EMPTY;
const selectCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function friendly(m: string) {
  if (m.includes("sales_components_code_key")) return "รหัสชิ้นส่วนนี้มีอยู่แล้ว";
  if (m.includes("recipes_component_id_sku_id_key")) return "SKU นี้อยู่ในสูตรแล้ว";
  if (m.includes("install_category")) return "หมวดติดตั้งไม่ถูกต้อง";
  return m;
}

function ComponentsPage() {
  const { canEditMaster } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);

  const { data: comps, isLoading } = useQuery({
    queryKey: ["sales_components"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_components").select("*, recipes(id)").order("code");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async ({ id, form }: { id: string | null; form: Form }) => {
      const row: TablesInsert<"sales_components"> = {
        code: form.code.trim(),
        name: form.name.trim(),
        unit: form.unit.trim() || "ม.",
        install_category: form.install_category || null,
        is_roll_product: form.is_roll_product,
        roll_family: form.roll_family.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (id) {
        const { error } = await supabase.from("sales_components").update(row).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await supabase.from("sales_components").insert(row).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id, v) => {
      toast.success("บันทึกชิ้นส่วนแล้ว");
      setEditing({ id, form: v.form });
      qc.invalidateQueries({ queryKey: ["sales_components"] });
    },
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  async function importComps(rows: Record<string, string>[]) {
    const payload: TablesInsert<"sales_components">[] = rows.map((r, i) => {
      if (!r.code || !r.name) throw new Error(`แถว ${i + 2}: ต้องมี code และ name`);
      const cat = r.install_category || null;
      if (cat && !INSTALL_CATEGORIES.includes(cat)) throw new Error(`แถว ${i + 2}: หมวดติดตั้งไม่ถูกต้อง "${cat}"`);
      return {
        code: r.code, name: r.name, unit: r.unit || "ม.", install_category: cat,
        is_roll_product: boolCsv(r.is_roll_product), roll_family: r.roll_family || null,
      };
    });
    const { error } = await supabase.from("sales_components").upsert(payload, { onConflict: "code" });
    if (error) throw new Error(friendly(error.message));
    qc.invalidateQueries({ queryKey: ["sales_components"] });
    return payload.length;
  }

  async function importRecipes(rows: Record<string, string>[]) {
    const [{ data: cs, error: e1 }, { data: ss, error: e2 }] = await Promise.all([
      supabase.from("sales_components").select("id, code"),
      supabase.from("skus").select("id, code"),
    ]);
    if (e1 || e2) throw e1 ?? e2;
    const cMap = new Map(cs!.map((c) => [c.code, c.id]));
    const sMap = new Map(ss!.map((s) => [s.code, s.id]));
    const payload = rows.map((r, i) => {
      const component_id = cMap.get(r.component_code);
      const sku_id = sMap.get(r.sku_code);
      if (!component_id) throw new Error(`แถว ${i + 2}: ไม่พบชิ้นส่วนรหัส "${r.component_code}"`);
      if (!sku_id) throw new Error(`แถว ${i + 2}: ไม่พบ SKU รหัส "${r.sku_code}"`);
      const qty = numCsv(r.qty_per_unit);
      if (qty === null || qty <= 0) throw new Error(`แถว ${i + 2}: qty_per_unit ต้องมากกว่า 0`);
      return { component_id, sku_id, qty_per_unit: qty };
    });
    const { error } = await supabase.from("recipes").upsert(payload, { onConflict: "component_id,sku_id" });
    if (error) throw new Error(friendly(error.message));
    qc.invalidateQueries({ queryKey: ["recipes"] });
    qc.invalidateQueries({ queryKey: ["sales_components"] });
    return payload.length;
  }

  const s = search.trim().toLowerCase();
  const list = (comps ?? []).filter(
    (c) => !s || [c.code, c.name, c.roll_family ?? "", c.install_category ?? ""].some((x) => x.toLowerCase().includes(s)),
  );

  return (
    <div>
      <PageHeader
        title="ชิ้นส่วนขายและสูตร"
        description="ชื่อที่ใช้ในใบเสนอราคา และสูตรว่า 1 หน่วยขายใช้ SKU อะไรเท่าไร"
        actions={
          canEditMaster ? (
            <>
              <CsvImport label="นำเข้าชิ้นส่วน CSV" columns="code,name,unit,install_category,is_roll_product,roll_family" onRows={importComps} />
              <CsvImport label="นำเข้าสูตร CSV" columns="component_code,sku_code,qty_per_unit" onRows={importRecipes} />
              <Button size="sm" onClick={() => setEditing({ id: null, form: { ...EMPTY } })}>เพิ่มชิ้นส่วน</Button>
            </>
          ) : null
        }
      />

      <Input className="mb-4 max-w-sm" placeholder="ค้นหารหัส ชื่อ หมวด..." value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>รหัส</Th><Th>ชื่อ (ตามใบเสนอราคา)</Th><Th>หน่วย</Th><Th>หมวดติดตั้ง</Th>
              <Th>ม้วน</Th><Th>ตระกูลม้วน</Th><Th>รายการในสูตร</Th><Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><Td colSpan={8}>กำลังโหลด...</Td></tr>
            ) : list.length ? (
              list.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.unit}</Td>
                  <Td>{c.install_category ?? "-"}</Td>
                  <Td>{c.is_roll_product ? "ใช่" : "-"}</Td>
                  <Td className="font-mono text-xs">{c.roll_family ?? "-"}</Td>
                  <Td>{c.recipes.length}</Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: c.id, form: toForm(c) })}>
                      {canEditMaster ? "แก้ไข/สูตร" : "ดูสูตร"}
                    </Button>
                  </Td>
                </tr>
              ))
            ) : (
              <tr><Td colSpan={8}>{s ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีชิ้นส่วนขาย"}</Td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? `ชิ้นส่วน ${editing.form.code}` : "เพิ่มชิ้นส่วนขาย"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <>
              <CompForm
                key={editing.id ?? "new"}
                initial={editing.form}
                readOnly={!canEditMaster}
                pending={save.isPending}
                onSubmit={(form) => save.mutate({ id: editing.id, form })}
              />
              {editing.id ? (
                <RecipeTable componentId={editing.id} unit={editing.form.unit} canEdit={canEditMaster} />
              ) : (
                <p className="text-sm text-muted-foreground">บันทึกชิ้นส่วนก่อน แล้วจึงเพิ่มสูตรได้</p>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toForm(c: Comp): Form {
  return {
    code: c.code, name: c.name, unit: c.unit, install_category: c.install_category ?? "",
    is_roll_product: c.is_roll_product, roll_family: c.roll_family ?? "", notes: c.notes ?? "",
  };
}

function CompForm({
  initial, readOnly, pending, onSubmit,
}: { initial: Form; readOnly: boolean; pending: boolean; onSubmit: (f: Form) => void }) {
  const [f, setF] = useState(initial);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <fieldset disabled={readOnly} className="contents">
        <Field label="รหัส *"><Input required value={f.code} onChange={set("code")} /></Field>
        <Field label="หน่วย"><Input value={f.unit} onChange={set("unit")} /></Field>
        <Field label="ชื่อ (ตรงตามที่ใช้ในใบเสนอราคา) *" className="sm:col-span-2">
          <Input required value={f.name} onChange={set("name")} />
        </Field>
        <Field label="หมวดติดตั้ง">
          <select className={selectCls} value={f.install_category} onChange={set("install_category")}>
            <option value="">— ไม่ระบุ —</option>
            {INSTALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="ตระกูลม้วน"><Input value={f.roll_family} onChange={set("roll_family")} /></Field>
        <div className="flex items-center gap-2">
          <Checkbox id="is_roll_product" checked={f.is_roll_product} onCheckedChange={(v) => setF({ ...f, is_roll_product: v === true })} />
          <label htmlFor="is_roll_product" className="text-sm">เป็นสินค้าม้วน</label>
        </div>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Input value={f.notes} onChange={set("notes")} /></Field>
        {!readOnly ? (
          <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={pending}>บันทึกชิ้นส่วน</Button></div>
        ) : null}
      </fieldset>
    </form>
  );
}

function RecipeTable({ componentId, unit, canEdit }: { componentId: string; unit: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["recipes", componentId];
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["sales_components"] }); };

  const { data: items } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes").select("id, qty_per_unit, sku_id, skus(code, name, unit)").eq("component_id", componentId).order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const { data: skus } = useQuery({
    queryKey: ["skus", "options"],
    enabled: canEdit,
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, code, name, unit").order("code");
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async (p: { sku_id: string; qty: number }) => {
      const { error } = await supabase.from("recipes").insert({ component_id: componentId, sku_id: p.sku_id, qty_per_unit: p.qty });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("เพิ่มเข้าสูตรแล้ว"); refresh(); },
    onError: (e: Error) => toast.error(friendly(e.message)),
  });
  const update = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
      const { error } = await supabase.from("recipes").update({ qty_per_unit: qty }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("แก้ไขจำนวนแล้ว"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-2 border-t border-border pt-4">
      <h3 className="mb-2 text-sm font-semibold">สูตร (ต่อ 1 {unit})</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr><Th>รหัส SKU</Th><Th>ชื่อสินค้า</Th><Th>จำนวนต่อหน่วย</Th><Th>หน่วย</Th>{canEdit ? <Th>{""}</Th> : null}</tr>
          </thead>
          <tbody>
            {(items ?? []).map((it) => {
              const sku = it.skus as { code: string; name: string; unit: string } | null;
              return (
                <tr key={it.id} className="border-t border-border">
                  <Td className="font-mono text-xs">{sku?.code}</Td>
                  <Td>{sku?.name}</Td>
                  <Td>
                    {canEdit ? (
                      <QtyCell value={Number(it.qty_per_unit)} onSave={(qty) => update.mutate({ id: it.id, qty })} />
                    ) : formatQty(Number(it.qty_per_unit))}
                  </Td>
                  <Td>{sku?.unit}</Td>
                  {canEdit ? (
                    <Td><Button size="sm" variant="ghost" onClick={() => remove.mutate(it.id)}>ลบ</Button></Td>
                  ) : null}
                </tr>
              );
            })}
            {items?.length === 0 ? <tr><Td colSpan={5}>ยังไม่มีรายการในสูตร</Td></tr> : null}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <AddRecipeItem skus={skus ?? []} showNote={false} pending={add.isPending} onAdd={(p) => add.mutate(p)} />
      ) : null}
    </div>
  );
}

function QtyCell({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  const dirty = toNumber(v) !== value;
  return (
    <div className="flex items-center gap-2">
      <Input className="h-8 w-24" value={v} onChange={(e) => setV(e.target.value)} />
      {dirty ? (
        <Button size="sm" variant="outline" onClick={() => {
          const n = toNumber(v);
          if (n === null || n <= 0) { toast.error("จำนวนต้องมากกว่า 0"); return; }
          onSave(n);
        }}>บันทึก</Button>
      ) : null}
    </div>
  );
}
