import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Pencil, ShieldOff, Trash2, UserPlus, Lock, LockOpen } from "lucide-react";
import { PageHeader } from "@/components/AppLayout";
import { ConfirmPasswordDialog } from "@/components/ConfirmPasswordDialog";
import { Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/useMe";
import { ROLE_LABELS, type AppRole } from "@/lib/erp";
import { formatDate } from "@/lib/format";
import { generatePassword, normalizeUsername, passwordError, usernameError } from "@/lib/accounts";
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserMfa,
  resetUserPassword,
  setUserDisabled,
  updateUser,
  type AdminUserRow,
} from "@/lib/users.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "ผู้ใช้และสิทธิ์ | CCSE ERP" },
      { name: "description", content: "จัดการผู้ใช้ User ID อีเมล รหัสผ่าน และสิทธิ์ของทีมงาน" },
      { property: "og:title", content: "ผู้ใช้และสิทธิ์ | CCSE ERP" },
      { property: "og:description", content: "กำหนดสิทธิ์การเข้าถึงข้อมูลของทีมงาน" },
    ],
  }),
  component: UsersPage,
});

/** Roles grouped the way the teams work (PRD section 3). */
const ROLE_GROUPS: { team: string; roles: AppRole[] }[] = [
  { team: "Admin", roles: ["admin"] },
  { team: "ทีมขาย", roles: ["sales", "estimator"] },
  { team: "ทีมจัดซื้อ", roles: ["stock"] },
  { team: "ทีมการเงิน", roles: ["accounting"] },
  { team: "ทีมผลิต", roles: ["production"] },
  { team: "ช่าง", roles: ["technician"] },
];

type Confirm = {
  title: string;
  body: React.ReactNode;
  label: string;
  destructive?: boolean;
  run: (adminPassword: string) => Promise<void>;
};

function UsersPage() {
  const { isAdmin, me } = useMe();
  const qc = useQueryClient();
  const [form, setForm] = useState<{ mode: "create" } | { mode: "edit"; user: AdminUserRow } | null>(null);
  const [resetFor, setResetFor] = useState<AdminUserRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [handover, setHandover] = useState<{ title: string; username: string; password: string } | null>(null);

  const { data: users, isLoading, error } = useQuery({
    queryKey: ["admin_users"],
    enabled: isAdmin,
    retry: 1,
    queryFn: () => listUsers(),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin_users"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="ผู้ใช้และสิทธิ์" />
        <p className="text-sm text-muted-foreground">หน้านี้เฉพาะผู้ดูแลระบบ (admin) เท่านั้น</p>
      </div>
    );
  }

  const nameOf = (u: AdminUserRow) => u.fullName || u.username || u.email || u.id.slice(0, 8);

  return (
    <div>
      <PageHeader
        title="ผู้ใช้และสิทธิ์"
        description="สร้างบัญชีด้วย User ID + รหัสชั่วคราว ผู้ใช้เปลี่ยนรหัสและใส่อีเมลเองที่ “บัญชีของฉัน” · ทุกการเปลี่ยนแปลงต้องใส่รหัสผ่านของคุณอีกครั้ง"
        actions={
          <Button onClick={() => setForm({ mode: "create" })}>
            <UserPlus className="h-4 w-4" /> เพิ่มผู้ใช้
          </Button>
        }
      />

      {error ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          โหลดรายชื่อผู้ใช้ไม่ได้:{" "}
          {/SERVICE_ROLE_KEY/.test((error as Error).message)
            ? "เครื่องมือจัดการผู้ใช้ทำงานบนเว็บที่ Lovable เผยแพร่เท่านั้น (เครื่องทดสอบนี้ไม่มีกุญแจผู้ดูแล)"
            : (error as Error).message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>ชื่อ</Th>
              <Th>User ID</Th>
              <Th>อีเมล</Th>
              <Th>สิทธิ์</Th>
              <Th>2 ชั้น</Th>
              <Th>เข้าใช้ล่าสุด</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={7}>กำลังโหลด...</Td>
              </tr>
            ) : null}
            {(users ?? []).map((u) => {
              const self = u.id === me?.userId;
              return (
                <tr key={u.id} className={"border-t border-border align-top " + (u.disabled ? "opacity-60" : "")}>
                  <Td>
                    <div className="font-medium">{nameOf(u)}</div>
                    {u.disabled ? <div className="text-xs text-destructive">ปิดการใช้งาน</div> : null}
                    {u.mustChangePassword && !u.disabled ? (
                      <div className="text-xs text-muted-foreground">รอเปลี่ยนรหัสครั้งแรก</div>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-xs">{u.username ?? <span className="text-muted-foreground">-</span>}</Td>
                  <Td className="text-xs">
                    {u.email ? (
                      <>
                        <div>{u.email}</div>
                        <div className={u.emailConfirmed ? "text-success" : "text-muted-foreground"}>
                          {u.emailConfirmed ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน"}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">ยังไม่ใส่อีเมล</span>
                    )}
                    {u.pendingEmail ? <div className="text-muted-foreground">รอยืนยัน: {u.pendingEmail}</div> : null}
                  </Td>
                  <Td className="text-xs">
                    {u.roles.length ? u.roles.map((r) => ROLE_LABELS[r]).join(" · ") : <span className="text-destructive">ยังไม่กำหนดสิทธิ์</span>}
                  </Td>
                  <Td className="text-xs">{u.mfa ? "เปิด" : "-"}</Td>
                  <Td className="whitespace-nowrap text-xs">{u.lastSignIn ? formatDate(u.lastSignIn) : "ยังไม่เคย"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => setForm({ mode: "edit", user: u })}>
                        <Pencil className="h-3.5 w-3.5" /> แก้ไข
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setResetFor(u)}>
                        <KeyRound className="h-3.5 w-3.5" /> รีเซ็ตรหัส
                      </Button>
                      {u.mfa ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="ลบรหัส 2 ชั้น (เมื่อผู้ใช้ทำมือถือหาย)"
                          onClick={() =>
                            setConfirm({
                              title: `รีเซ็ตรหัส 2 ชั้นของ ${nameOf(u)}`,
                              body: "ผู้ใช้จะเข้าระบบด้วยรหัสผ่านอย่างเดียวได้ แล้วตั้งรหัส 2 ชั้นใหม่เองที่ “บัญชีของฉัน”",
                              label: "รีเซ็ตรหัส 2 ชั้น",
                              run: async (adminPassword) => {
                                await resetUserMfa({ data: { userId: u.id, adminPassword } });
                                toast.success("ลบรหัส 2 ชั้นแล้ว");
                                refresh();
                              },
                            })
                          }
                        >
                          <ShieldOff className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {!self ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          title={u.disabled ? "เปิดใช้งานอีกครั้ง" : "ปิดการใช้งาน (เข้าระบบไม่ได้ ข้อมูลยังอยู่)"}
                          onClick={() =>
                            setConfirm({
                              title: `${u.disabled ? "เปิดใช้งาน" : "ปิดการใช้งาน"} ${nameOf(u)}`,
                              body: u.disabled
                                ? "ผู้ใช้จะเข้าระบบได้อีกครั้งด้วยสิทธิ์เดิม"
                                : "ผู้ใช้จะเข้าระบบไม่ได้ทันที ข้อมูลที่เขาบันทึกไว้ยังอยู่ครบ",
                              label: u.disabled ? "เปิดใช้งาน" : "ปิดการใช้งาน",
                              destructive: !u.disabled,
                              run: async (adminPassword) => {
                                await setUserDisabled({ data: { userId: u.id, disabled: !u.disabled, adminPassword } });
                                toast.success(u.disabled ? "เปิดใช้งานแล้ว" : "ปิดการใช้งานแล้ว");
                                refresh();
                              },
                            })
                          }
                        >
                          {u.disabled ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        </Button>
                      ) : null}
                      {!self ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="ลบผู้ใช้"
                          onClick={() =>
                            setConfirm({
                              title: `ลบผู้ใช้ ${nameOf(u)}`,
                              body: (
                                <>
                                  ลบบัญชีและสิทธิ์ทั้งหมด ถ้าผู้ใช้เคยบันทึกงานไว้ ระบบจะ <b>ปิดการใช้งาน</b> แทนเพื่อเก็บประวัติ
                                </>
                              ),
                              label: "ลบผู้ใช้",
                              destructive: true,
                              run: async (adminPassword) => {
                                const r = await deleteUser({ data: { userId: u.id, adminPassword } });
                                toast.success(r.deleted ? "ลบผู้ใช้แล้ว" : "มีงานที่ผู้ใช้บันทึกไว้ — ปิดการใช้งานและถอดสิทธิ์แทน");
                                refresh();
                              },
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        เข้าระบบได้ทั้ง User ID และอีเมลที่ยืนยันแล้ว · ปิดการใช้งาน = เข้าระบบไม่ได้แต่ข้อมูลยังอยู่
      </p>

      {form ? (
        <UserFormDialog
          initial={form.mode === "edit" ? form.user : null}
          isSelf={form.mode === "edit" && form.user.id === me?.userId}
          onClose={() => setForm(null)}
          onSubmit={(v) => {
            const before = form.mode === "edit" ? form.user : null;
            setForm(null); // one dialog at a time: the password check replaces the form
            setConfirm({
              title: before ? `บันทึกการแก้ไข ${nameOf(before)}` : `สร้างผู้ใช้ ${v.username}`,
              body: <ChangeSummary before={before} after={v} />,
              label: before ? "บันทึก" : "สร้างผู้ใช้",
              run: async (adminPassword) => {
                if (before) {
                  await updateUser({
                    data: {
                      userId: before.id,
                      fullName: v.fullName,
                      username: v.username,
                      email: v.email,
                      roles: v.roles,
                      adminPassword,
                    },
                  });
                  toast.success("บันทึกแล้ว");
                } else {
                  await createUser({
                    data: { fullName: v.fullName, username: v.username, password: v.password, roles: v.roles, adminPassword },
                  });
                  setHandover({ title: "สร้างผู้ใช้แล้ว", username: v.username, password: v.password });
                }
                refresh();
              },
            });
          }}
        />
      ) : null}

      {resetFor ? (
        <ResetPasswordDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onSubmit={(newPassword) => {
            const target = resetFor;
            setResetFor(null);
            setConfirm({
              title: `รีเซ็ตรหัสผ่านของ ${nameOf(target)}`,
              body: "รหัสเดิมจะใช้ไม่ได้ทันที และผู้ใช้ต้องเปลี่ยนรหัสใหม่เมื่อเข้าระบบครั้งถัดไป",
              label: "รีเซ็ตรหัสผ่าน",
              destructive: true,
              run: async (adminPassword) => {
                await resetUserPassword({ data: { userId: target.id, newPassword, adminPassword } });
                setHandover({
                  title: "รีเซ็ตรหัสผ่านแล้ว",
                  username: target.username ?? target.email ?? "",
                  password: newPassword,
                });
                refresh();
              },
            });
          }}
        />
      ) : null}

      {confirm ? (
        <ConfirmPasswordDialog
          title={confirm.title}
          confirmLabel={confirm.label}
          destructive={!!confirm.destructive}
          onConfirm={confirm.run}
          onClose={() => setConfirm(null)}
        >
          {confirm.body}
        </ConfirmPasswordDialog>
      ) : null}

      {handover ? <HandoverDialog {...handover} onClose={() => setHandover(null)} /> : null}
    </div>
  );
}

type FormValue = { fullName: string; username: string; email: string; password: string; roles: AppRole[] };

function ChangeSummary({ before, after }: { before: AdminUserRow | null; after: FormValue }) {
  const roles = (rs: AppRole[]) => (rs.length ? rs.map((r) => ROLE_LABELS[r]).join(" · ") : "ไม่มีสิทธิ์");
  const rows: [string, string, string][] = [];
  const push = (label: string, a: string, b: string) => {
    if (a !== b) rows.push([label, a || "-", b || "-"]);
  };
  push("ชื่อ", before?.fullName ?? "", after.fullName);
  push("User ID", before?.username ?? "", after.username);
  if (before) push("อีเมล", before.email ?? "", after.email);
  push("สิทธิ์", before ? roles(before.roles) : "", roles(after.roles));
  if (!rows.length) return <p className="text-muted-foreground">ไม่มีอะไรเปลี่ยน</p>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label} className="border-t border-border">
            <td className="py-1 pr-2 text-muted-foreground">{label}</td>
            {before ? <td className="py-1 pr-2 line-through">{a}</td> : null}
            <td className="py-1 font-medium">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UserFormDialog({
  initial,
  isSelf,
  onClose,
  onSubmit,
}: {
  initial: AdminUserRow | null;
  isSelf: boolean;
  onClose: () => void;
  onSubmit: (v: FormValue) => void;
}) {
  const [v, setV] = useState<FormValue>({
    fullName: initial?.fullName ?? "",
    username: initial?.username ?? "",
    email: initial?.email ?? "",
    password: initial ? "" : generatePassword(),
    roles: initial?.roles ?? [],
  });
  const set = (k: keyof FormValue) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const toggle = (r: AppRole) =>
    setV({ ...v, roles: v.roles.includes(r) ? v.roles.filter((x) => x !== r) : [...v.roles, r] });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = usernameError(v.username) ?? (initial ? null : passwordError(v.password));
    if (err) {
      toast.error(err);
      return;
    }
    if (isSelf && !v.roles.includes("admin")) {
      toast.error("ถอดสิทธิ์ admin ของตัวเองไม่ได้");
      return;
    }
    onSubmit({ ...v, username: normalizeUsername(v.username), fullName: v.fullName.trim(), email: v.email.trim() });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้"}</DialogTitle>
        </DialogHeader>
        <form id="user-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="uf-name">ชื่อ-นามสกุล</Label>
              <Input id="uf-name" value={v.fullName} onChange={set("fullName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uf-username">User ID (ใช้เข้าระบบ)</Label>
              <Input
                id="uf-username"
                value={v.username}
                placeholder="เช่น somchai.k"
                autoCapitalize="none"
                onChange={set("username")}
              />
            </div>
          </div>
          {initial ? (
            <div className="space-y-1.5">
              <Label htmlFor="uf-email">อีเมล (เว้นว่างได้ — ผู้ใช้ใส่และยืนยันเองได้)</Label>
              <Input id="uf-email" type="email" value={v.email} onChange={set("email")} />
              <p className="text-xs text-muted-foreground">อีเมลที่ admin ใส่ให้ถือว่ายืนยันแล้ว ใช้เข้าระบบได้ทันที</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="uf-password">รหัสผ่านชั่วคราว</Label>
              <div className="flex gap-2">
                <Input id="uf-password" className="font-mono" value={v.password} onChange={set("password")} />
                <Button type="button" variant="outline" onClick={() => setV({ ...v, password: generatePassword() })}>
                  สุ่มใหม่
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">ผู้ใช้ต้องเปลี่ยนรหัสนี้เมื่อเข้าระบบครั้งแรก</p>
            </div>
          )}
          <div className="space-y-2">
            <Label>สิทธิ์</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_GROUPS.map((g) => (
                <div key={g.team} className="rounded-md border border-border p-2">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">{g.team}</div>
                  {g.roles.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={v.roles.includes(r)} onChange={() => toggle(r)} />
                      {ROLE_LABELS[r]}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {v.roles.includes("sales") && v.roles.includes("stock") ? (
              <p className="text-xs text-destructive">
                ฝ่ายขาย + ฝ่ายคลัง ในคนเดียวกันจะเห็นทั้งราคาขายและต้นทุน (รู้กำไร)
              </p>
            ) : null}
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" form="user-form">
            ถัดไป
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onSubmit,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onSubmit: (newPassword: string) => void;
}) {
  const [pw, setPw] = useState(generatePassword());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>รีเซ็ตรหัสผ่าน — {user.fullName || user.username}</DialogTitle>
        </DialogHeader>
        <form
          id="reset-form"
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const err = passwordError(pw);
            if (err) toast.error(err);
            else onSubmit(pw);
          }}
        >
          <Label htmlFor="reset-pw">รหัสผ่านชั่วคราวใหม่</Label>
          <div className="flex gap-2">
            <Input id="reset-pw" className="font-mono" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => setPw(generatePassword())}>
              สุ่มใหม่
            </Button>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" form="reset-form">
            ถัดไป
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shown once after create / reset so admin can hand the User ID + temporary password over. */
function HandoverDialog({
  title,
  username,
  password,
  onClose,
}: {
  title: string;
  username: string;
  password: string;
  onClose: () => void;
}) {
  const text = `User ID: ${username}\nรหัสผ่านชั่วคราว: ${password}\nเข้าระบบแล้วจะถูกขอให้ตั้งรหัสใหม่`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 rounded-md border border-border bg-secondary p-3 font-mono text-sm">
          <div>User ID: {username}</div>
          <div>รหัสผ่านชั่วคราว: {password}</div>
        </div>
        <p className="text-xs text-muted-foreground">
          ส่งให้ผู้ใช้ทางช่องทางส่วนตัว รหัสนี้จะแสดงครั้งเดียว ผู้ใช้ต้องตั้งรหัสใหม่เมื่อเข้าระบบครั้งแรก
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("คัดลอกแล้ว"))}
          >
            คัดลอก
          </Button>
          <Button onClick={onClose}>เสร็จ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
