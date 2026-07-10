import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export const metadata = { title: "Login · POA System" };

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentUser();
  if (session) redirect("/dashboard");

  const { error } = await props.searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Pharos" className="mx-auto mb-5 h-10 w-auto" />
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-text)" }}>
            POA System
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Masukkan NIP Anda untuk melanjutkan
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-lg border p-6"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <form action={loginAction} className="flex flex-col gap-4">
            <Input
              name="nip"
              label="NIP (Nomor Induk Pegawai)"
              placeholder="Contoh: MR001"
              autoComplete="username"
              autoFocus
              required
            />

            {error && (
              <p
                className="rounded px-3 py-2 text-sm"
                style={{
                  color: "var(--color-error)",
                  background: "var(--color-error-bg)",
                }}
              >
                {error}
              </p>
            )}

            <Button type="submit" className="w-full mt-1">
              Masuk
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: "var(--color-text-faint)" }}>
          Akun hanya dapat dibuat oleh administrator sistem.
        </p>
      </div>
    </div>
  );
}
