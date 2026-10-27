import Image from "next/image";
import logo from "@/public/logo.png";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Cheque Funding Tracker" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <Image src={logo} alt="Wythlae and WWJ Trading Corporation" priority className="h-28 w-auto self-center rounded-xl" />
      <h1 className="text-center text-2xl font-semibold text-accent">Cheque Funding Tracker</h1>
      <div className="rounded-xl border border-line bg-card p-5">
        <LoginForm />
      </div>
      <p className="text-center text-xs text-muted">
        First time? Sign in with username <span className="font-mono">owner</span> and the shared password, then create your
        own account under Users.
      </p>
    </main>
  );
}
