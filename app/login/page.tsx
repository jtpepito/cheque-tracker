import Image from "next/image";
import logo from "@/public/logo.png";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Cheque Funding Tracker" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <Image src={logo} alt="Wythlae" width={96} height={96} priority className="h-24 w-24 self-center rounded-full" />
      <h1 className="text-center text-2xl font-semibold">Cheque Funding Tracker</h1>
      <div className="rounded-xl border border-line bg-card p-5">
        <LoginForm />
      </div>
    </main>
  );
}
