"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Squad } from "@/lib/types";

const emptyForm = { nome: "", label: "", cor: "", incluir_em_comparativo: true };

export default function SquadsPage() {
  const supabase = createClient();
  const [squads, setSquads] = useState<Squad[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("ruston_squads").select("*").order("nome");
    setSquads((data as Squad[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      nome: form.nome.toUpperCase(),
      label: form.label || null,
      cor: form.cor || null,
      incluir_em_comparativo: form.incluir_em_comparativo,
    };
    if (editingId) {
      await supabase.from("ruston_squads").update(payload).eq("id", editingId);
    } else {
      await supabase.from("ruston_squads").insert(payload);
    }
    setForm(emptyForm);
    setEditingId(null);
    setOpen(false);
    load();
  }

  function edit(s: Squad) {
    setForm({
      nome: s.nome,
      label: s.label ?? "",
      cor: s.cor ?? "",
      incluir_em_comparativo: s.incluir_em_comparativo ?? true,
    });
    setEditingId(s.id);
    setOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleAtivo(id: string, ativo: boolean) {
    await supabase.from("ruston_squads").update({ ativo: !ativo }).eq("id", id);
    load();
  }

  async function toggleComparativo(id: string, atual: boolean) {
    await supabase.from("ruston_squads").update({ incluir_em_comparativo: !atual }).eq("id", id);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Remover squad? Clientes e pessoas vinculados ficam sem squad (não são apagados).")) return;
    await supabase.from("ruston_squads").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Squads</h1>
          <p className="text-sm text-brand-muted">{squads.length} squads cadastrados</p>
        </div>
        <button className="btn" onClick={() => { setEditingId(null); setForm(emptyForm); setOpen(!open); }}>
          {open ? "Fechar" : "+ Novo squad"}
        </button>
      </div>

      {open && (
        <form onSubmit={save} className="card mb-6">
          <p className="mb-3 text-sm font-semibold">{editingId ? "Editar squad" : "Novo squad"}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Nome *</label>
              <input className="input" required value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="BRAVA, OLIMPO, ATLAS..." />
            </div>
            <div>
              <label className="label">Label</label>
              <input className="input" value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="SQUAD 1" />
            </div>
            <div>
              <label className="label">Cor (hex)</label>
              <input className="input" value={form.cor}
                onChange={(e) => setForm({ ...form, cor: e.target.value })}
                placeholder="#e11d2a" />
            </div>
            <div className="sm:col-span-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.incluir_em_comparativo}
                  onChange={(e) => setForm({ ...form, incluir_em_comparativo: e.target.checked })}
                  className="h-4 w-4"
                />
                <span className="text-sm">Incluir no dash Comparativo de Metas</span>
                <span className="text-xs text-brand-muted">
                  (desmarque pra squads administrativos ou coordenações especiais)
                </span>
              </label>
            </div>
            <div className="sm:col-span-3 flex gap-2">
              <button type="submit" className="btn">{editingId ? "Atualizar" : "Salvar"}</button>
              <button type="button" className="btn-ghost"
                onClick={() => { setEditingId(null); setForm(emptyForm); setOpen(false); }}>Cancelar</button>
            </div>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className="text-brand-muted">Carregando...</p>
        ) : squads.length === 0 ? (
          <p className="text-brand-muted">Nenhum squad ainda.</p>
        ) : squads.map((s) => (
          <div key={s.id} className={`card ${!s.ativo ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg font-bold text-white"
                     style={{ backgroundColor: s.cor || "#1a1a1a" }}>
                  {s.nome.charAt(0)}
                </div>
                <div>
                  <p className="text-base font-bold tracking-wider">{s.nome}</p>
                  <p className="text-xs text-brand-muted">{s.label ?? "—"}</p>
                </div>
              </div>
            </div>

            {/* Toggle Comparativo */}
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wide text-brand-muted">Comparativo</span>
              <button
                onClick={() => toggleComparativo(s.id, s.incluir_em_comparativo ?? true)}
                className={`text-xs font-semibold ${(s.incluir_em_comparativo ?? true) ? "text-emerald-300" : "text-brand-muted"}`}
              >
                {(s.incluir_em_comparativo ?? true) ? "✓ Incluso" : "✗ Excluído"}
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button onClick={() => edit(s)} className="btn-ghost flex-1 text-xs">Editar</button>
              <button onClick={() => toggleAtivo(s.id, s.ativo)} className="btn-ghost text-xs">
                {s.ativo ? "Desativar" : "Ativar"}
              </button>
              <button onClick={() => remove(s.id)} className="btn-ghost text-xs text-red-300">Excluir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
