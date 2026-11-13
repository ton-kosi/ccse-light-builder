import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { matchesSearch } from "@/lib/fetchAll";

export type PickOption = { id: string; label: string; sub?: string | null; search?: (string | null | undefined)[] };

/** Type part of a code or name, pick from the matches (for long lists: suppliers, SKUs, projects). */
export function SearchPicker({
  options,
  value,
  onChange,
  placeholder,
  emptyLabel = "— ไม่ระบุ —",
  disabled,
  max = 30,
}: {
  options: PickOption[] | undefined;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string | null;
  disabled?: boolean;
  max?: number;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const chosen = options?.find((o) => o.id === value) ?? null;
  const matches = useMemo(
    () => (options ?? []).filter((o) => matchesSearch(text, o.search ?? [o.label, o.sub])).slice(0, max),
    [options, text, max],
  );
  return (
    <div className="relative">
      <Input
        value={open ? text : chosen ? chosen.label : ""}
        placeholder={options ? (placeholder ?? `พิมพ์เพื่อค้นหา (${options.length.toLocaleString()} รายการ)`) : "กำลังโหลด…"}
        disabled={disabled}
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
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-md border border-border bg-popover text-sm shadow">
          {emptyLabel !== null ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-muted-foreground hover:bg-secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {emptyLabel}
            </button>
          ) : null}
          {matches.map((o) => (
            <button
              type="button"
              key={o.id}
              className={"block w-full px-3 py-1.5 text-left hover:bg-secondary " + (o.id === value ? "bg-secondary font-medium" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(o.id);
                setText("");
                setOpen(false);
              }}
            >
              <div>{o.label}</div>
              {o.sub ? <div className="text-xs text-muted-foreground">{o.sub}</div> : null}
            </button>
          ))}
          {!matches.length ? <div className="px-3 py-1.5 text-muted-foreground">ไม่พบ</div> : null}
          {matches.length === max ? <div className="px-3 py-1.5 text-xs text-muted-foreground">แสดง {max} รายการแรก พิมพ์เพิ่มเพื่อหาให้ตรงขึ้น</div> : null}
        </div>
      ) : null}
    </div>
  );
}
