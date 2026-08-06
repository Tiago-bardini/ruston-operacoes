"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import type { UsuarioPerfil, Squad, Pessoa, PerfilUsuario } from "@/lib/types";
import { PERFIL_LABEL } from "@/lib/types";

export default function UsuariosPage() {
  const supabase = createClient();
  const router = useRouter();
  const { loading: loadingPerfil, isGerente } = useUsuarioPerfil();

  const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Redirect se não for Gerente
  useEffect(() => {
    if (!loadingPerfil && !isGerente) router.push("/cockpit");
  }, [loadingPerfil, isGerente, router]);

  async function load() {
    setLoading(true);
    const [{ data: us }, { data: sq }, { data: ps }] = await Promise.all([
      supabase.from("ruston_usuario_perfil").select("*").order("email"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
    ]);
    setUsuarios((us as UsuarioPerfil[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    setPessoas((ps as Pessoa[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (isGerente) load(); /* eslint-disable-next-line */ }, [isGerente]);

  async function atualizar(u: UsuarioPerfil, campo: keyof UsuarioPerfil, valor: any) {
    setSaving(u.id);
    await supabase.from("ruston_usuario_perfil").update({ [campo]: valor }).eq("id", u.id);
    setSaving(null);
    load();
  }

  async function remover(u: UsuarioPerfil) {
    if (!confirm(`Remover o acesso de ${u.email}? Ele vai perder acesso ao sistema.`)) return;
    await supabase.from("ruston_usuario_perfil").delete().eq("id", u.id);
    load();
  }

  async function toggleAtivo(u: UsuarioPerfil) {
    await supabase.from("ruston_usuario_perfil").update({ ativo: !u.ativo }).eq("id", u.id);
    load();
  }

  if (loadingPerfil) return <p className="text-brand-muted">Carregando...</p>;
  if (!isGerente) return <p className="text-brand-muted">Acesso negado.</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Gestão de Usuários</h1>
        <p className="text-sm text-brand-muted">
          Defina o perfil de cada pessoa que tem acesso ao sistema · só Gerente vê essa tela
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-brand/40 bg-brand/5 p-3 text-xs text-brand-muted">
        <p className="mb-1"><strong className="text-white">O que cada perfil vê:</strong></p>
        <ul className="space-y-0.5 list-disc list-inside">
          <li><strong className="text-red-300">Gerente</strong>: tudo (incluindo Salários, Headcount, Forecast, Gestão de Usuários)</li>
          <li><strong className="text-amber-300">Coordenador</strong>: opera o squad dele · NÃO vê Salários/Headcount/Forecast</li>
          <li><strong className="text-emerald-300">Investidor</strong>: opera o squad dele · NÃO vê Salários/Headcount/Forecast/Gestão</li>
        </ul>
      </div>

      {loading && <p className="text-brand-muted">Carregando usuários...</p>}

      {!loading && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3 w-40">Perfil</th>
                <th className="px-4 py-3 w-48">Squad</th>
                <th className="px-4 py-3 w-56">Vinculado a (pessoa)</th>
                <th className="px-4 py-3 w-24">Ativo</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-brand-muted">
                  Nenhum usuário cadastrado ainda. Quando alguém se cadastrar em /login com @v4company.com,
                  ele aparece aqui automaticamente após rodar o SQL de sincronização.
                </td></tr>
              )}
              {usuarios.map((u) => (
                <tr key={u.id} className={`border-b border-white/5 last:border-0 ${!u.ativo ? "opacity-40" : ""}`}>
                  <td className="px-4 py-3 font-medium">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input py-1 text-xs"
                      value={u.perfil}
                      onChange={(e) => atualizar(u, "perfil", e.target.value as PerfilUsuario)}
                    >
                      <option value="gerente">Gerente</option>
                      <option value="coordenador">Coordenador</option>
                      <option value="investidor">Investidor</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="input py-1 text-xs"
                      value={u.squad_id ?? ""}
                      onChange={(e) => atualizar(u, "squad_id", e.target.value || null)}
                    >
                      <option value="">— (sem squad)</option>
                      {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="input py-1 text-xs"
                      value={u.pessoa_id ?? ""}
                      onChange={(e) => atualizar(u, "pessoa_id", e.target.value || null)}
                    >
                      <option value="">— (não vincular)</option>
                      {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleAtivo(u)}
                      className={`badge ${u.ativo ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-white/5 text-brand-muted border-white/10"}`}
                    >
                      {u.ativo ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remover(u)}
                      className="text-xs text-red-300 hover:text-red-400">remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {saving && <p className="p-2 text-[10px] text-brand-muted">salvando...</p>}
        </div>
      )}

      <div className="mt-6 card text-xs text-brand-muted">
        <p className="mb-1 font-semibold text-white">Como onboarding funciona:</p>
        <ol className="space-y-1 list-decimal list-inside">
          <li>Pessoa acessa <code className="text-brand">ruston-operacoes.vercel.app</code></li>
          <li>Clica em "Criar uma" e cadastra com email @v4company.com</li>
          <li>A pessoa entra automaticamente como <strong>Investidor</strong> (você ajusta aqui pra Coordenador se for o caso)</li>
          <li>Se ela é Coordenador ou Investidor, defina o <strong>Squad</strong> dela</li>
          <li>Opcional: vincule ela a uma pessoa cadastrada em /pessoas pra deixar o rastro completo</li>
        </ol>
      </div>
    </div>
  );
}
