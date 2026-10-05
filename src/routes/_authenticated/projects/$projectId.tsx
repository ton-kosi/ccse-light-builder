
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={"flex justify-between " + (bold ? "border-t border-border pt-1 font-semibold" : "")}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AddBoqLine({
  components,
  onAdd,
  pending,
}: {
  components: { id: string; code: string; sales_name: string; unit: string }[];
  onAdd: (p: {
    sales_name: string;
    description: string;
    qty: number | null;
    unit: string;
    unit_price: number | null;
    sales_component_id: string | null;
    is_header: boolean;
    option_name: string;
  }) => void;
  pending?: boolean;
}) {
  const [salesName, setSalesName] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [componentId, setComponentId] = useState("");
  const [isHeader, setIsHeader] = useState(false);
  const [optionName, setOptionName] = useState("");

  return (
    <form
      className="mt-6 grid gap-3 border-t border-border pt-4 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!salesName.trim()) { toast.error("กรุณากรอกชื่อรายการ"); return; }
        onAdd({
          sales_name: salesName,
          description,
          qty: toNumber(qty),
          unit,
          unit_price: toNumber(price),
          sales_component_id: componentId || null,
          is_header: isHeader,
          option_name: optionName,
        });
        setSalesName("");
        setDescription("");
        setQty("");
        setUnit("");
        setPrice("");
        setComponentId("");
      }}
    >
      <Field label="ชื่อรายการ *" className="md:col-span-2">
        <Input value={salesName} onChange={(e) => setSalesName(e.target.value)} />
      </Field>
      <Field label="รายละเอียด" className="md:col-span-2">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="จำนวน">
        <Input value={qty} onChange={(e) => setQty(e.target.value)} disabled={isHeader} />
      </Field>
      <Field label="หน่วย">
        <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={isHeader} />
      </Field>
      <Field label="ราคา/หน่วย (บาท)">
        <Input value={price} onChange={(e) => setPrice(e.target.value)} disabled={isHeader} />
      </Field>
      <Field label="Option (เว้นว่าง = รายการหลัก)">
        <Input value={optionName} placeholder="เช่น A" onChange={(e) => setOptionName(e.target.value)} />
      </Field>
      <Field label="ผูกกับส่วนประกอบขาย" className="md:col-span-2">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={componentId}
          onChange={(e) => setComponentId(e.target.value)}
        >
          <option value="">— ไม่ผูก (ใช้สูตรเฉพาะรายการ) —</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.sales_name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end gap-3 md:col-span-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={isHeader}
            onChange={(e) => setIsHeader(e.target.checked)}
          />
          เป็นหัวข้อ (ไม่มีราคา)
        </label>
        <Button size="sm" type="submit" disabled={pending}>
          เพิ่มรายการ
        </Button>
      </div>
    </form>
  );
}

function LineRecipeEditor({
  lineId,
  componentId,
  canEdit,
}: {
  lineId: string;
  componentId: string | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: lineItems } = useQuery({
    queryKey: ["line_recipes", lineId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_recipes")
        .select("id, qty_per_unit, note, skus(code, name, unit)")
        .eq("quotation_line_id", lineId);
      if (error) throw error;
      return data;
    },
  });

  const { data: stdItems } = useQuery({
    queryKey: ["recipes", componentId],
    enabled: !!componentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, qty_per_unit, skus(code, name, unit)")
        .eq("component_id", componentId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: skus } = useQuery({
    queryKey: ["skus", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, code, name, unit").order("code");
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async (p: { sku_id: string; qty: number; note: string }) => {
      const { error } = await supabase.from("line_recipes").insert({
        quotation_line_id: lineId,
        sku_id: p.sku_id,
        qty_per_unit: p.qty,
        note: p.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการในสูตรเฉพาะแล้ว");
      queryClient.invalidateQueries({ queryKey: ["line_recipes", lineId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("line_recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["line_recipes", lineId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {componentId ? (
        <div>
          <div className="text-xs font-semibold text-muted-foreground">
            สูตรมาตรฐานจากส่วนประกอบ (ต่อ 1 หน่วย)
          </div>
          <ul className="mt-1 text-sm">
            {(stdItems ?? []).map((it) => {
              const sku = it.skus as { code: string; name: string; unit: string } | null;
              return (
                <li key={it.id}>
                  • {sku?.name} ({sku?.code}) — {formatQty(Number(it.qty_per_unit))} {sku?.unit}
                </li>
              );
            })}
            {stdItems?.length === 0 ? <li className="text-muted-foreground">— ไม่มี —</li> : null}
          </ul>
        </div>
      ) : null}

      <div>
        <div className="text-xs font-semibold text-muted-foreground">
          สูตรเฉพาะรายการนี้ (ต่อ 1 หน่วย)
        </div>
        <ul className="mt-1 space-y-1 text-sm">
          {(lineItems ?? []).map((it) => {
            const sku = it.skus as { code: string; name: string; unit: string } | null;
            return (
              <li key={it.id} className="flex items-center gap-3">
                <span>
                  • {sku?.name} ({sku?.code}) — {formatQty(Number(it.qty_per_unit))} {sku?.unit}
                  {"note" in it && it.note ? ` · ${it.note}` : ""}
                </span>
                {canEdit ? (
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(it.id)}>
                    ลบ
                  </Button>
                ) : null}
              </li>
            );
          })}
          {lineItems?.length === 0 ? <li className="text-muted-foreground">— ไม่มี —</li> : null}
        </ul>
      </div>

      {canEdit ? (
        <AddRecipeItem
          skus={skus ?? []}
          onAdd={(p) => add.mutate(p)}
          pending={add.isPending}
          label="เพิ่มเข้าสูตรเฉพาะรายการ"
        />
      ) : null}
    </div>
  );
}

/* ---------------- Work orders ---------------- */

function WorkOrderSection({
  projectId,
  projectStatus,
  canEdit,
}: {
  projectId: string;
  projectStatus: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: "", wo_type: "production", scheduled_date: "" });

  const { data: workOrders } = useQuery({
    queryKey: ["work_orders", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("work_orders").insert({
        project_id: projectId,
        doc_no: "WO-" + new Date().getTime().toString().slice(-6),
        title: form.title,
        wo_type: form.wo_type,
        scheduled_date: form.scheduled_date || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างใบสั่งงาน (ร่าง) แล้ว");
      setForm({ title: "", wo_type: "production", scheduled_date: "" });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const release = useMutation({
    mutationFn: async (id: string) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("work_orders")
        .update({
          status: "released",
          released_at: new Date().toISOString(),
          released_by: user.user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ปล่อยใบสั่งงานแล้ว");
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canRelease = projectStatus >= RELEASE_MIN_STATUS;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">ใบสั่งงาน</h2>
      <p className="text-xs text-muted-foreground">
        ใบสั่งงานไม่แสดงราคาหรือต้นทุนใดๆ — ปล่อยงานได้เมื่อสถานะโปรเจกต์ถึงขั้น {RELEASE_MIN_STATUS}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>เลขที่</Th>
              <Th>เรื่อง</Th>
              <Th>ประเภท</Th>
              <Th>กำหนดวันที่</Th>
              <Th>สถานะ</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(workOrders ?? []).map((w) => (
              <tr key={w.id} className="border-t border-border">
                <Td className="font-mono text-xs">
                  <Link
                    to="/work-orders/$woId"
                    params={{ woId: w.id }}
                    className="text-primary hover:underline"
                  >
                    {w.doc_no}
                  </Link>
                </Td>
                <Td className="font-medium">{w.title || "-"}</Td>
                <Td>{woTypeLabel(w.wo_type)}</Td>
                <Td>{w.scheduled_date ? formatDate(w.scheduled_date) : "-"}</Td>
                <Td>{woStatusLabel(w.status)}</Td>
                <Td>
                  {canEdit && w.status === "draft" ? (
                    <Button
                      size="sm"
                      disabled={!canRelease || release.isPending}
                      onClick={() => release.mutate(w.id)}
                    >
                      ปล่อยงาน
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
            {workOrders?.length === 0 ? (
              <tr>
                <Td colSpan={6}>ยังไม่มีใบสั่งงาน</Td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <form
          className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="เรื่อง / งานที่ต้องทำ" className="md:col-span-2">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="ประเภท">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.wo_type}
              onChange={(e) => setForm({ ...form, wo_type: e.target.value })}
            >
              {WO_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="กำหนดวันที่">
            <Input
              type="date"
              value={form.scheduled_date}
              onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
            />
          </Field>
          <div className="md:col-span-4">
            <Button size="sm" type="submit" disabled={create.isPending}>
              สร้างใบสั่งงาน (ร่าง)
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
