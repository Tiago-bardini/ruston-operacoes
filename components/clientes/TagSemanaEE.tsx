"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Semana da Estruturação Estratégica (S1 a S5) de cada cliente em E.E (migration 014).
 *  Lido direto de ruston_clientes: a view não traz a coluna nova. Se a coluna ainda não
 *  existir, volta vazio e a tela segue funcionando sem as tags. */
export async function carregarSemanasEE(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("ruston_clientes")
    .select("id, semana_ee").eq("ativo", true).not("semana_ee", "is", null);
  if (error) return {};
  const mapa: Record<string, number> = {};
  (data ?? []).forEach((c: { id: string; semana_ee: number }) => { mapa[c.id] = c.semana_ee; });
  return mapa;
}

export async function salvarSemanaEE(supabase: SupabaseClient, clienteId: string, semana: number | null) {
  const { error } = await supabase.from("ruston_clientes").update({ semana_ee: semana }).eq("id", clienteId);
  return error;
}

const COR_TAG = "border-sky-500/40 bg-sky-500/15 text-sky-300";

/** Tag "S3" ao lado do nome. Com onChange vira um seletor (— / S1…S5). */
export function TagSemanaEE({ semana, onChange, size = "sm" }: {
  semana: number | null | undefined;
  onChange?: (s: number | null) => void;
  size?: "sm" | "xs";
}) {
  const texto = size === "xs" ? "text-[8px] px-1.5 py-0.5" : "text-[10px] px-1.5 py-0.5";
  if (!onChange) {
    if (!semana) return null;
    return (
      <span className={`inline-flex shrink-0 items-center rounded border font-bold ${COR_TAG} ${texto}`}
        title={`Estruturação Estratégica · Semana ${semana}`}>S{semana}</span>
    );
  }
  return (
    <label className={`relative inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded border font-bold ${texto} ${
      semana ? COR_TAG : "border-dashed border-white/20 text-brand-muted hover:text-gray-200"}`}
      title="Semana da Estruturação Estratégica">
      {semana ? `S${semana}` : "S?"} <span className="text-[7px]">▼</span>
      <select
        value={semana ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <option value="" className="bg-brand-panel text-gray-100">Sem semana</option>
        {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s} className="bg-brand-panel text-gray-100">S{s}</option>)}
      </select>
    </label>
  );
}
