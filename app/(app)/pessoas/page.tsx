"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pessoa, Squad, Cargo, NivelSenioridade, VersaoV } from "@/lib/types";
import { CARGO_LABEL, NIVEL_LABEL, V_LABEL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

const CARGOS: Cargo[] = [
  "coordenador", "gestor_projetos", "gestor_trafego", "designer",
  "social_media", "copy", "gerente", "coo", "tech", "outro",
];

const NIVEIS: NivelSenioridade[] = ["junior", "pleno", "senior", "especialista"];
const VS: VersaoV[] = ["v1", "v2", "v3", "v4"];

// cargos que costumam ter escadinha de senioridade/V
const CARGOS_COM_SENIORIDADE: Cargo[] = [
  "designer", "gestor_projetos", "gestor_trafego", "social_media", "copy",
];

const emptyForm = {
  nome: "",
  email: "",
  cargo: "gestor_projetos" as Cargo,
  squad_id: "",
  nivel_senioridade: "" as NivelSenioridade | "",
  nivel_v: "" as VersaoV | "",
  salario: "",
  compartilhado_entre_squads: false,
  observacoes: "",
};

export default function PessoasPage() {
  const supabase = createClient();
  const { podeVerSalario } = useUsuarioPerfil();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterCargo, setFilterCargo] = useState<Cargo | "">("");
  const [filterSquad, setFilterSquad] = useState<string>("");

  async function load() {
    setLoading(true);
    const [{ data: ps }, { data: sq }] = await Promise.all([
      supabase.from("ruston_pessoas").select("*").order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
    ]);
    setPessoas((ps as Pessoa[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      nome: form.nome,
      email: form.email || null,
      cargo: form.cargo,
      squad_id: form.squad_id || null,
      nivel_senioridade: form.nivel_senioridade || null,
      nivel_v: form.nivel_v || null,
      salario: form.salario ? Number(form.salario) : null,
      compartilhado_entre_squads: form.compartilhado_entre_squads,
      observacoes: form.observacoes || null,
    };
    if (editingId) {
      await supabase.from("ruston_pessoas").update(payload).eq("id", editingId);
    } else {
      await supabase.from("ruston_pessoas").insert(payload);
    }
    setForm(emptyForm);
    setEditingId(null);
    setOpen(false);
    load();
  }

  function edit(p: Pessoa) {
    setForm({
      nome: p.nome,
      email: p.email ?? "",
      cargo: p.cargo,
      squad_id: p.squad_id ?? "",
      nivel_senioridade: p.nivel_senioridade ?? "",
      nivel_v: p.nivel_v ?? "",
      salario: p.salario != null ? String(p.salario) : "",
      compartilhado_entre_squads: p.compartilhado_entre_squads ?? false,
      observacoes: p.observacoes ?? "",
    });
    setEditingId(p.id);
    setOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleAtivo(id: string, ativo: boolean) {
    await supabase.from("ruston_pessoas").update({ ativo: !ativo }).eq("id", id);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Remover pessoa? Se ela é responsável por clientes, eles ficam sem responsável (não são apagados).")) return;
    await supabase.from("ruston_pessoas").delete().eq("id", id);
    load();
  }

  const squadNome = (id: string | null) => squads.find((s) => s.id === id)?.nome ?? "—";

  const filtered = pessoas.filter((p) => {
    if (filterCargo && p.cargo !== filterCargo) return false;
    if (filterSquad && p.squad_id !== filterSquad) return false;
    return true;
  });

  const mostrarSenioridade = CARGOS_COM_SENIORIDADE.includes(form.cargo);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pessoas</h1>
          <p className="text-sm text-brand-muted">{filtered.length} de {pessoas.length} pessoas</p>
        </div>
        <button className="btn" onClick={() => { setEditingId(null); setForm(emptyForm); setOpen(!open); }}>
          {open ? "Fechar" : "+ Nova pessoa"}
        </button>
      </div>

      <div className="mb-4 flex gap-3">
        <select className="input max-w-xs" value={filterCargo}
          onChange={(e) => setFilterCargo(e.target.value as Cargo | "")}>
          <option value="">Todos os cargos</option>
          {CARGOS.map((c) => <option key={c} value={c}>{CARGO_LABEL[c]}</option>)}
        </select>
        <select className="input max-w-xs" value={filterSquad}
          onChange={(e) => setFilterSquad(e.target.value)}>
          <option value="">Todos os squads</option>
          {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </div>

      {open && (
        <form onSubmit={save} className="card mb-6">
          <p className="mb-3 text-sm font-semibold">{editingId ? "Editar pessoa" : "Nova pessoa"}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Nome *</label>
              <input className="input" required value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input type="email" className="input" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Cargo *</label>
              <select className="input" value={form.cargo}
                onChange={(e) => setForm({ ...form, cargo: e.target.value as Cargo })}>
                {CARGOS.map((c) => <option key={c} value={c}>{CARGO_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Squad</label>
              <select className="input" value={form.squad_id}
                onChange={(e) => setForm({ ...form, squad_id: e.target.value })}>
                <option value="">Nenhum</option>
                {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
            {mostrarSenioridade && (
              <>
                <div>
                  <label className="label">Nível de senioridade</label>
                  <select className="input" value={form.nivel_senioridade}
                    onChange={(e) => setForm({ ...form, nivel_senioridade: e.target.value as NivelSenioridade | "" })}>
                    <option value="">—</option>
                    {NIVEIS.map((n) => <option key={n} value={n}>{NIVEL_LABEL[n]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Nível V</label>
                  <select className="input" value={form.nivel_v}
                    onChange={(e) => setForm({ ...form, nivel_v: e.target.value as VersaoV | "" })}>
                    <option value="">—</option>
                    {VS.map((v) => <option key={v} value={v}>{V_LABEL[v]}</option>)}
                  </select>
                </div>
              </>
            )}
            {podeVerSalario && (
              <>
                <div>
                  <label className="label">Salário (R$)</label>
                  <input type="number" step="0.01" className="input" value={form.salario}
                    onChange={(e) => setForm({ ...form, salario: e.target.value })}
                    placeholder="ex: 5000" />
                </div>
                <div className="lg:col-span-2">
                  <label className="label">Alocação</label>
                  <label className="flex h-10 items-center gap-2 cursor-pointer rounded-lg border border-white/10 bg-brand-panel/50 px-3">
                    <input
                      type="checkbox"
                      checked={form.compartilhado_entre_squads}
                      onChange={(e) => setForm({ ...form, compartilhado_entre_squads: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Compartilhado entre squads (Gerente, Tech, COO)</span>
                  </label>
                </div>
              </>
            )}
            <div className="lg:col-span-3">
              <label className="label">Observações</label>
              <input className="input" value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
            </div>
            <div className="lg:col-span-3 flex gap-2">
              <button type="submit" className="btn">{editingId ? "Atualizar" : "Salvar"}</button>
              <button type="button" className="btn-ghost"
                onClick={() => { setEditingId(null); setForm(emptyForm); setOpen(false); }}>Cancelar</button>
            </div>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Cargo</th>
              <th className="px-4 py-3">Nível</th>
              <th className="px-4 py-3">Squad</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-brand-muted">Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-brand-muted">
                {pessoas.length === 0 ? "Nenhuma pessoa cadastrada. Clica em '+ Nova pessoa' pra começar." : "Nenhuma pessoa com esses filtros."}
              </td></tr>
            ) : filtered.map((p) => (
              <tr key={p.id} className={`border-b border-white/5 last:border-0 ${!p.ativo ? "opacity-40" : ""}`}>
                <td className="px-4 py-3 font-medium">{p.nome}</td>
                <td className="px-4 py-3 text-brand-muted">{CARGO_LABEL[p.cargo]}</td>
                <td className="px-4 py-3 text-brand-muted">
                  {p.nivel_senioridade
                    ? `${NIVEL_LABEL[p.nivel_senioridade]}${p.nivel_v ? " " + V_LABEL[p.nivel_v] : ""}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-brand-muted">{squadNome(p.squad_id)}</td>
                <td className="px-4 py-3 text-brand-muted">{p.email ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${p.ativo ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-white/5 text-brand-muted border-white/10"}`}>
                    {p.ativo ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button onClick={() => edit(p)} className="text-xs text-brand-muted hover:text-gray-200">editar</button>
                  <button onClick={() => toggleAtivo(p.id, p.ativo)} className="text-xs text-brand-muted hover:text-gray-200">
                    {p.ativo ? "desativar" : "ativar"}
                  </button>
                  <button onClick={() => remove(p.id)} className="text-xs text-brand-muted hover:text-red-400">excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
