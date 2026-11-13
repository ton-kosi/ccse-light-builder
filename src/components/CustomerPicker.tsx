import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { fetchAll, matchesSearch } from "@/lib/fetchAll";

type Option = { id: string; code: string | null; name: string };

/** All customers (more than the 1,000 rows one request returns), for pickers. */
export function useCustomerOptions() {
  return useQuery({
    queryKey: ["customers", "options"],
    queryFn: () =>
      fetchAll<Option>((from, to) => supabase.from("customers").select("id, code, name").order("name").range(from, to)),
  });
}

const label = (c: Option) => (c.code ? `${c.code} · ${c.name}` : c.name);

/** Type part of a code or name, then pick from the matches. */
export function CustomerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data: customers } = useCustomerOptions();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const chosen = customers?.find((c) => c.id === value) ?? null;
  const matches = useMemo(
    () => (customers ?? []).filter((c) => matchesSearch(text, [c.code, c.name])).slice(0, 30),
    [customers, text],
  );
  return (
    <div className="relative">
      <Input
        value={open ? text : chosen ? label(chosen) : text}
        placeholder={customers ? `พิมพ์รหัสหรือชื่อ (${customers.length.toLocaleString()} ราย)` : "กำลังโหลดลูกค้า…"}
        onFocus={() => {
          setText("");
          setOpen(true);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover text-sm shadow">
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-muted-foreground hover:bg-secondary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            — ไม่ระบุ —
          </button>
          {matches.map((c) => (
            <button
              type="button"
              key={c.id}
              className={"block w-full px-3 py-1.5 text-left hover:bg-secondary " + (c.id === value ? "bg-secondary font-medium" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c.id);
                setText("");
                setOpen(false);
              }}
            >
              {c.code ? <span className="mr-2 text-muted-foreground">{c.code}</span> : null}
              {c.name}
            </button>
          ))}
          {!matches.length ? <div className="px-3 py-1.5 text-muted-foreground">ไม่พบ — เพิ่มที่หน้า ลูกค้า</div> : null}
          {matches.length === 30 ? <div className="px-3 py-1.5 text-xs text-muted-foreground">แสดง 30 รายการแรก พิมพ์เพิ่มเพื่อหาให้ตรงขึ้น</div> : null}
        </div>
      ) : null}
    </div>
  );
}
