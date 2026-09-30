import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { ROLE_LABELS, type AppRole } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
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
                <Td className="font-medium">{p.full_name || p.id.slice(0, 8)}</Td>
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
        ผู้ใช้จะปรากฏในตารางนี้หลังเข้าสู่ระบบครั้งแรก
      </p>
    </div>
  );
}
