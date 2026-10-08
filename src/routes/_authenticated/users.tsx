import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { ROLE_LABELS, type AppRole } from "@/lib/erp";
import { inviteUser } from "@/lib/users.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "ผู้ใช้และสิทธิ์ | CCSE ERP" },
      { name: "description", content: "กำหนดสิทธิ์ผู้ใช้: ผู้บริหาร ฝ่ายขาย ฝ่ายผลิต ช่างติดตั้ง" },
      { property: "og:title", content: "ผู้ใช้และสิทธิ์ | CCSE ERP" },
      { property: "og:description", content: "กำหนดสิทธิ์การเข้าถึงข้อมูลของทีมงาน" },
    ],
  }),
  component: UsersPage,
});

const ALL_ROLES: AppRole[] = ["admin", "sales", "estimator", "stock", "production", "accounting", "technician"];

function UsersPage() {
  const { isAdmin: isCeo } = useMe();
  const queryClient = useQueryClient();

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: roles } = useQuery({
    queryKey: ["user_roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("id, user_id, role");
      if (error) throw error;
      return data;
    },
  });

  const toggle = useMutation({
    mutationFn: async ({
      userId,
      role,
      on,
    }: {
      userId: string;
      role: AppRole;
      on: boolean;
    }) => {
      if (on) {
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", role);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("ปรับสิทธิ์แล้ว");
      queryClient.invalidateQueries({ queryKey: ["user_roles"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async ({ userId, fullName }: { userId: string; fullName: string }) => {
      const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกชื่อแล้ว");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isCeo) {
    return (
      <div>
        <PageHeader title="ผู้ใช้และสิทธิ์" />
        <p className="text-sm text-muted-foreground">หน้านี้เฉพาะผู้ดูแลระบบ (admin) เท่านั้น</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="ผู้ใช้และสิทธิ์"
        description="ฝ่ายผลิตและช่างจะไม่เห็นใบเสนอราคา ราคาขาย และต้นทุน"
      />
      <InviteForm />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>ชื่อผู้ใช้</Th>
              {ALL_ROLES.map((r) => (
                <Th key={r}>{ROLE_LABELS[r]}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p) => (
              <tr key={p.id} className="border-t border-border">
                <Td>
                  <NameCell
                    userId={p.id}
                    initial={p.full_name || ""}
                    fallback={p.id.slice(0, 8)}
                    editable={isCeo}
                    onSave={(fullName) => rename.mutate({ userId: p.id, fullName })}
                  />
                </Td>
                {ALL_ROLES.map((r) => {
                  const on = (roles ?? []).some((x) => x.user_id === p.id && x.role === r);
                  return (
                    <Td key={r}>
                      <Button
                        size="sm"
                        variant={on ? "default" : "outline"}
                        onClick={() => toggle.mutate({ userId: p.id, role: r, on: !on })}
                      >
                        {on ? "มีสิทธิ์" : "ไม่มี"}
                      </Button>
                    </Td>
                  );
                })}
              </tr>
            ))}
            {profiles?.length === 0 ? (
              <tr>
                <Td colSpan={5}>ยังไม่มีผู้ใช้อื่นในระบบ</Td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        ผู้ใช้จะปรากฏในตารางนี้หลังเข้าสู่ระบบครั้งแรก · คลิกที่ชื่อเพื่อแก้ไข
      </p>
    </div>
  );
}

function InviteForm() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");

  const invite = useMutation({
    mutationFn: async () => {
      await inviteUser({
        data: { email, fullName, redirectTo: window.location.origin },
      });
    },
    onSuccess: () => {
      toast.success(`ส่งคำเชิญไปที่ ${email} แล้ว`);
      setEmail("");
      setFullName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        invite.mutate();
      }}
    >
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="invite-name">
          ชื่อ-นามสกุล
        </label>
        <Input
          id="invite-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-56"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="invite-email">
          อีเมล
        </label>
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-64"
        />
      </div>
      <Button type="submit" disabled={invite.isPending}>
        {invite.isPending ? "กำลังส่งคำเชิญ..." : "เชิญผู้ใช้"}
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        ระบบจะส่งอีเมลเชิญให้ผู้ใช้ตั้งรหัสผ่านเอง แล้วค่อยกำหนดสิทธิ์ในตารางด้านล่าง
      </p>
    </form>
  );
}

function NameCell({
  userId,
  initial,
  fallback,
  editable,
  onSave,
}: {
  userId: string;
  initial: string;
  fallback: string;
  editable: boolean;
  onSave: (fullName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);

  if (!editable) {
    return <span className="font-medium">{initial || fallback}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left font-medium underline decoration-dotted underline-offset-4 hover:text-primary"
        title="แก้ไขชื่อ"
        onClick={() => {
          setValue(initial);
          setEditing(true);
        }}
      >
        {initial || fallback}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (value.trim() !== initial) onSave(value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setValue(initial);
          setEditing(false);
        }
      }}
      aria-label={`ชื่อผู้ใช้ ${userId.slice(0, 8)}`}
    />
  );
}
