import { Check, X } from "lucide-react";
import { passwordChecks } from "@/lib/accounts";

/** Live checklist under a new-password field: each rule turns green as it is met. */
export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" aria-live="polite">
      {passwordChecks(value).map((c) => (
        <li key={c.label} className={"flex items-center gap-1 " + (c.ok ? "text-success" : "text-muted-foreground")}>
          {c.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 text-destructive" />}
          {c.label}
        </li>
      ))}
    </ul>
  );
}
