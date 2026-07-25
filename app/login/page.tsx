"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setLoading(false);
    if (error) { setError(error.message); return; }
    if (mode === "signup") {
      setError("Conta criada. Se a confirmação por email estiver ativa, confirme antes de entrar.");
      setMode("signin");
      return;
    }
    router.push("/clientes");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-xl font-black">R</div>
          <h1 className="text-2xl font-bold">Ruston Operações</h1>
          <p className="text-sm text-brand-muted">Painel operacional interno</p>
        </div>
        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input type="email" className="input" value={email} required autoComplete="email"
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Senha</label>
            <input type="password" className="input" value={password} required autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          <button type="submit" className="btn w-full" disabled={loading}>
            {loading ? "..." : mode === "signin" ? "Entrar" : "Criar conta"}
          </button>
          <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
            className="w-full text-center text-xs text-brand-muted hover:text-gray-200">
            {mode === "signin" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
