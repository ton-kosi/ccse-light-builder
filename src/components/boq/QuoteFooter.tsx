import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PAY_TRIGGERS } from "@/components/payments/PaymentTermsSection";
import {
  CLAUSE_SECTIONS,
  defaultPrintLabel,
  groupBySection,
  type ClauseSection,
} from "@/lib/clauses";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
import { syncQuotationClauses } from "@/lib/clauseSync";

export const DEFAULT_CLOSING =
  "WE HOPE THAT OUR QUOTATION CAN BE OF CONSIDERABLE VALUE TO YOUR COMPANY.";

type Quotation = Tables<"quotations">;
type QClause = Tables<"quotation_clauses">;
type Term = Tables<"payment_terms">;

const card = "rounded-lg border border-border bg-background p-4";

/**
 * Everything printed at the bottom of the quotation, edited in the same order and position:
 * notes & warranty → closing line → signer (left) | TERM OF PAYMENT, VALIDITY, DELIVERY, APPROVED BY (right).
 */
export function QuoteFooter({
  quotation,
  selectedOption,
  syncKey,
  net,
  canEdit,
}: {
  quotation: Quotation;
  selectedOption: string | null;
  /** Changes whenever lines or the selected option change, so linked clauses are re-synced. */
  syncKey: string;
  net: number;
  canEdit: boolean;
}) {
  return (
    <div className="mt-6 space-y-4">
      <ClauseEditor
        quotationId={quotation.id}
        selectedOption={selectedOption}
        syncKey={syncKey}
        canEdit={canEdit}
        legacyNotes={quotation.notes}
      />
      <SignOff quotation={quotation} net={net} canEdit={canEdit} />
    </div>
  );
}

/* ---------------------------------------------------------------- notes & warranty */

function ClauseEditor({
  quotationId,
  selectedOption,
  syncKey,
  canEdit,
  legacyNotes,
}: {
  quotationId: string;
  selectedOption: string | null;
  syncKey: string;
  canEdit: boolean;
  legacyNotes: string | null;
}) {
  const qc = useQueryClient();
  const key = ["quotation_clauses", quotationId];
  const [adding, setAdding] = useState<{ section: ClauseSection; text: string }>({
    section: "note_th",
    text: "",
  });

  const { data: rows } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotation_clauses")
        .select("*")
        .eq("quotation_id", quotationId)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  // Pull in clauses of the SKUs/components used (and drop unused, unedited ones) whenever lines change.
  const lastSync = useRef("");
  useEffect(() => {
    if (!canEdit) return;
    const sig = `${quotationId}|${syncKey}`;
    if (sig === lastSync.current) return;
    const timer = setTimeout(async () => {
      lastSync.current = sig;
      try {
        await syncQuotationClauses(quotationId, selectedOption);
        qc.invalidateQueries({ queryKey: key });
      } catch (e) {
        toast.error("ดึงหมายเหตุอัตโนมัติไม่สำเร็จ: " + (e as Error).message);
      }
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationId, syncKey, canEdit]);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onError = (e: Error) => toast.error(e.message);

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"quotation_clauses"> }) => {
      const { error } = await supabase.from("quotation_clauses").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });
  const swap = useMutation({
    mutationFn: async ([a, b, dir]: [QClause, QClause, -1 | 1]) => {
      // equal sort orders (e.g. legacy rows) would make a plain swap a no-op
      const newA = a.sort_order === b.sort_order ? b.sort_order + dir : b.sort_order;
      const r1 = await supabase
        .from("quotation_clauses")
        .update({ sort_order: newA })
        .eq("id", a.id);
      if (r1.error) throw r1.error;
      const r2 = await supabase
        .from("quotation_clauses")
        .update({ sort_order: a.sort_order })
        .eq("id", b.id);
      if (r2.error) throw r2.error;
    },
    onSuccess: refresh,
    onError,
  });
  const insert = useMutation({
    mutationFn: async ({ section, text }: { section: ClauseSection; text: string }) => {
      const base = Math.max(0, ...(rows ?? []).map((r) => r.sort_order));
      const { error } = await supabase.from("quotation_clauses").insert({
        quotation_id: quotationId,
        section,
        text,
        sort_order: base + 1,
        edited: true,
        included: true,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quotation_clauses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });
  const moveLegacy = useMutation({
    mutationFn: async () => {
      const base = Math.max(0, ...(rows ?? []).map((r) => r.sort_order));
      const lines = (legacyNotes ?? "")
        .split("\n")
        .map((l) => l.replace(/^\s*-\s*/, "").trim())
        .filter(Boolean);
      if (lines.length) {
        const { error } = await supabase.from("quotation_clauses").insert(
          lines.map((text, i) => ({
            quotation_id: quotationId,
            section: "note_th",
            text,
            sort_order: base + i + 1,
            edited: true,
          })),
        );
        if (error) throw error;
      }
      const { error } = await supabase
        .from("quotations")
        .update({ notes: null })
        .eq("id", quotationId);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["quotation"] });
      toast.success("ย้ายหมายเหตุเดิมเข้ารายการแล้ว");
    },
    onError,
  });

  const groups = groupBySection(rows ?? []);
  const newCount = (rows ?? []).filter((r) => r.is_new).length;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">หมายเหตุและประกัน</h3>
        <span className="text-xs text-muted-foreground">
          ดึงจากชิ้นส่วนในใบนี้อัตโนมัติ · ติ๊กออกได้ · แก้ข้อความได้เฉพาะใบนี้
        </span>
      </div>

      {newCount > 0 && canEdit ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm">
          <span>มีข้อความใหม่ {newCount} ข้อ จากรายการที่เพิ่มเข้ามา</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() =>
              (rows ?? [])
                .filter((r) => r.is_new)
                .forEach((r) => update.mutate({ id: r.id, patch: { is_new: false } }))
            }
          >
            รับทราบทั้งหมด
          </Button>
        </div>
      ) : null}

      {legacyNotes?.trim() ? (
        <div className="mt-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <div className="font-medium">หมายเหตุเดิม (ข้อความอิสระ)</div>
          <div className="whitespace-pre-line text-muted-foreground">{legacyNotes}</div>
          {canEdit ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={moveLegacy.isPending}
              onClick={() => moveLegacy.mutate()}
            >
              ย้ายเป็นรายการหมายเหตุ
            </Button>
          ) : null}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          ยังไม่มีข้อความ — ผูกข้อความกับ SKU ได้ที่เมนู "หมายเหตุและประกัน"
          หรือเพิ่มเองด้านล่าง
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((g) => (
            <div key={g.value}>
              <div className="text-sm font-semibold">{g.heading}</div>
              <ul className="mt-1 space-y-1">
                {g.rows.map((r, i) => (
                  <li
                    key={r.id}
                    className={"flex items-start gap-2 " + (r.included ? "" : "opacity-50")}
                  >
                    <Checkbox
                      className="mt-2"
                      checked={r.included}
                      disabled={!canEdit}
                      onCheckedChange={(v) =>
                        update.mutate({
                          id: r.id,
                          patch: { included: v === true, edited: true, is_new: false },
                        })
                      }
                      aria-label="พิมพ์ข้อนี้"
                    />
                    <span className="mt-1.5 text-sm">-</span>
                    <Textarea
                      key={r.text}
                      rows={1}
                      className={
                        "min-h-8 flex-1 resize-y py-1 text-sm " + (r.included ? "" : "line-through")
                      }
                      defaultValue={r.text}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.text)
                          update.mutate({
                            id: r.id,
                            patch: { text: v, edited: true, is_new: false },
                          });
                      }}
                    />
                    <div className="flex shrink-0 items-center gap-1 pt-1">
                      {r.is_new ? (
                        <button
                          type="button"
                          className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                          title="กดเพื่อรับทราบ"
                          onClick={() =>
                            canEdit && update.mutate({ id: r.id, patch: { is_new: false } })
                          }
                        >
                          ใหม่
                        </button>
                      ) : null}
                      {r.edited && r.clause_id ? (
                        <span className="text-[11px] text-muted-foreground">แก้แล้ว</span>
                      ) : null}
                      {!r.clause_id ? (
                        <span className="text-[11px] text-muted-foreground">เพิ่มเอง</span>
                      ) : null}
                      {canEdit ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={i === 0}
                            onClick={() => swap.mutate([r, g.rows[i - 1]!, -1])}
                            aria-label="เลื่อนขึ้น"
                          >
                            ↑
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={i === g.rows.length - 1}
                            onClick={() => swap.mutate([r, g.rows[i + 1]!, 1])}
                            aria-label="เลื่อนลง"
                          >
                            ↓
                          </Button>
                          {!r.clause_id ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => remove.mutate(r.id)}
                            >
                              ลบ
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {canEdit ? (
        <form
          className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const text = adding.text.trim();
            if (!text) return;
            insert.mutate(
              { section: adding.section, text },
              { onSuccess: () => setAdding({ ...adding, text: "" }) },
            );
          }}
        >
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={adding.section}
            onChange={(e) => setAdding({ ...adding, section: e.target.value as ClauseSection })}
          >
            {CLAUSE_SECTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Input
            className="min-w-0 flex-1"
            placeholder="เพิ่มข้อความเฉพาะใบนี้"
            value={adding.text}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })}
          />
          <Button
            size="sm"
            type="submit"
            className="h-9"
            disabled={insert.isPending || !adding.text.trim()}
          >
            เพิ่ม
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- closing, signer, terms */

function SignOff({
  quotation,
  net,
  canEdit,
}: {
  quotation: Quotation;
  net: number;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const onError = (e: Error) => toast.error(e.message);

  const saveQuote = useMutation({
    mutationFn: async (patch: TablesUpdate<"quotations">) => {
      const { error } = await supabase.from("quotations").update(patch).eq("id", quotation.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotation", quotation.project_id] }),
    onError,
  });

  const { data: people } = useQuery({
    queryKey: ["profiles", "signers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name");
      if (error) throw error;
      return data.filter((p) => p.full_name?.trim());
    },
  });

  const closing = quotation.closing_text ?? DEFAULT_CLOSING;

  return (
    <section className={card}>
      <Textarea
        key={"closing" + quotation.id}
        rows={1}
        className="min-h-8 resize-y text-sm"
        defaultValue={closing}
        disabled={!canEdit}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== closing) saveQuote.mutate({ closing_text: v || null });
        }}
        aria-label="ข้อความปิดท้าย"
      />

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {/* left: signer */}
        <div className="space-y-2 text-sm">
          <div className="font-semibold">FAITHFULLY YOURS,</div>
          <div>CHINGCHAI &amp; SONS ENGINEERING CO., LTD.</div>
          <label className="block pt-2 text-xs text-muted-foreground">ผู้ลงนาม</label>
          {canEdit && people?.length ? (
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={quotation.signer_user_id ?? ""}
              onChange={(e) => {
                const p = people.find((x) => x.id === e.target.value);
                saveQuote.mutate({
                  signer_user_id: p?.id ?? null,
                  signer_name: p ? p.full_name.trim().toUpperCase() : quotation.signer_name,
                });
              }}
            >
              <option value="">— เลือกจากผู้ใช้ (หรือพิมพ์ชื่อด้านล่าง) —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          ) : null}
          <Input
            key={"sn" + quotation.signer_name}
            placeholder="ชื่อที่พิมพ์ เช่น TON KOSIYABONG"
            defaultValue={quotation.signer_name ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (quotation.signer_name ?? "")) saveQuote.mutate({ signer_name: v || null });
            }}
          />
          <Input
            key={"sp" + quotation.signer_position}
            placeholder="ตำแหน่ง เช่น MANAGING DIRECTOR"
            defaultValue={quotation.signer_position ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (quotation.signer_position ?? ""))
                saveQuote.mutate({ signer_position: v || null });
            }}
          />
        </div>

        {/* right: terms, validity, delivery, approved by */}
        <div className="space-y-3 text-sm">
          <TermsEditor quotationId={quotation.id} net={net} canEdit={canEdit} />
          <div className="grid grid-cols-[90px_1fr] items-center gap-2">
            <span className="font-semibold">VALIDITY :</span>
            <div className="flex items-center gap-2">
              <Input
                key={"v" + quotation.validity_days}
                className="h-8 w-20"
                defaultValue={
                  quotation.validity_days === null ? "" : String(quotation.validity_days)
                }
                disabled={!canEdit}
                onBlur={(e) => {
                  const n = toNumber(e.target.value);
                  const v = n === null ? null : Math.round(n);
                  if (v !== quotation.validity_days) saveQuote.mutate({ validity_days: v });
                }}
              />
              <span>DAYS</span>
            </div>
            <span className="self-start pt-1.5 font-semibold">DELIVERY :</span>
            <Textarea
              key={"d" + quotation.delivery_text}
              rows={2}
              className="min-h-8 resize-y text-sm"
              placeholder={"45-60 DAYS\nAFTER RECEIVED OF DEPOSIT"}
              defaultValue={quotation.delivery_text ?? ""}
              disabled={!canEdit}
              onBlur={(e) => {
                if (e.target.value !== (quotation.delivery_text ?? ""))
                  saveQuote.mutate({ delivery_text: e.target.value || null });
              }}
            />
          </div>
          <div className="pt-2 text-center text-xs text-muted-foreground">
            <div className="font-semibold text-foreground">APPROVED BY</div>
            <div className="mt-6">(……………………………)</div>
            <div>……/……/……..</div>
            <div className="mt-1">(ช่องให้ลูกค้าลงนาม)</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TermsEditor({
  quotationId,
  net,
  canEdit,
}: {
  quotationId: string;
  net: number;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const key = ["payment_terms", "quote", quotationId];
  const [form, setForm] = useState({ name: "", percent: "", trigger: "deposit" });

  const { data: terms } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_terms")
        .select("*")
        .eq("quotation_id", quotationId)
        .order("seq");
      if (error) throw error;
      return data;
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payment_terms"] });
    qc.invalidateQueries({ queryKey: ["payment_schedule"] });
  };
  const onError = (e: Error) => toast.error(e.message);
  const LOCKED = "งวดนี้วางบิลหรือรับเงินแล้ว แก้ไม่ได้ (ติดต่อบัญชี)";

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"payment_terms"> }) => {
      const { data, error } = await supabase
        .from("payment_terms")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(LOCKED);
    },
    onSuccess: refresh,
    onError: (e: Error) => {
      onError(e);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("payment_terms")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(LOCKED);
    },
    onSuccess: refresh,
    onError,
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("payment_terms").insert({
        quotation_id: quotationId,
        seq: Math.max(0, ...(terms ?? []).map((t) => t.seq)) + 1,
        name:
          form.name.trim() ||
          PAY_TRIGGERS.find((t) => t.value === form.trigger)?.label.replace(/\s*\(.*\)$/, "") ||
          "งวด",
        percent: toNumber(form.percent) ?? 0,
        trigger: form.trigger,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ name: "", percent: "", trigger: "after_delivery" });
      refresh();
    },
    onError,
  });

  const list = terms ?? [];
  const totalPct = list
    .filter((t) => t.fixed_amount === null)
    .reduce((s, t) => s + Number(t.percent), 0);
  const hasFixed = list.some((t) => t.fixed_amount !== null);
  const pctWrong = list.length > 0 && !hasFixed && Math.abs(totalPct - 100) > 0.001;

  return (
    <div>
      <div className="font-semibold">TERM OF PAYMENT:</div>
      {pctWrong ? (
        <p className="mt-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          รวม {formatQty(totalPct)}% — ต้องเท่ากับ 100%
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="mt-1 text-xs text-warning">
          ยังไม่มีงวดเงิน — ต้องมีอย่างน้อย 1 งวดก่อนออกใบเบิกเงิน
        </p>
      ) : null}
      <ul className="mt-1 space-y-2">
        {list.map((t) => {
          const def = defaultPrintLabel(t);
          const amount =
            t.fixed_amount !== null ? Number(t.fixed_amount) : (net * Number(t.percent)) / 100;
          return (
            <li key={t.id + t.updated_at} className="rounded border border-border p-2">
              <Input
                className="h-8 font-medium"
                defaultValue={t.print_label ?? ""}
                placeholder={def}
                disabled={!canEdit}
                title="ข้อความที่พิมพ์ในใบ (ว่าง = ใช้ข้อความอัตโนมัติ)"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (t.print_label ?? ""))
                    update.mutate({ id: t.id, patch: { print_label: v || null } });
                }}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">งวด {t.seq}</span>
                <Input
                  className="h-7 w-28 text-xs"
                  defaultValue={t.name}
                  disabled={!canEdit}
                  aria-label="ชื่องวด"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== t.name) update.mutate({ id: t.id, patch: { name: v } });
                  }}
                />
                <Input
                  className="h-7 w-14 text-xs"
                  defaultValue={String(t.percent)}
                  disabled={!canEdit}
                  aria-label="เปอร์เซ็นต์"
                  onBlur={(e) => {
                    const n = toNumber(e.target.value) ?? 0;
                    if (n !== Number(t.percent)) update.mutate({ id: t.id, patch: { percent: n } });
                  }}
                />
                <span>%</span>
                <select
                  className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                  value={t.trigger ?? ""}
                  disabled={!canEdit}
                  onChange={(e) =>
                    e.target.value &&
                    update.mutate({ id: t.id, patch: { trigger: e.target.value } })
                  }
                >
                  {!t.trigger ? <option value="">— เลือกเงื่อนไข —</option> : null}
                  {PAY_TRIGGERS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {formatTHB(amount)} บาท
                </span>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => remove.mutate(t.id)}
                  >
                    ลบ
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!toNumber(form.percent)) {
              toast.error("กรุณากรอก %");
              return;
            }
            add.mutate();
          }}
        >
          <Input
            className="h-8 w-16"
            placeholder="%"
            value={form.percent}
            onChange={(e) => setForm({ ...form, percent: e.target.value })}
          />
          <select
            className="h-8 rounded-md border border-input bg-background px-1 text-xs"
            value={form.trigger}
            onChange={(e) => setForm({ ...form, trigger: e.target.value })}
          >
            {PAY_TRIGGERS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          <Input
            className="h-8 min-w-0 flex-1"
            placeholder="ชื่องวด (ไม่บังคับ)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Button size="sm" type="submit" className="h-8" disabled={add.isPending}>
            เพิ่มงวด
          </Button>
        </form>
      ) : null}
    </div>
  );
}
