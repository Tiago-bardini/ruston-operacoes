"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Semana da Estruturação Estratégica (S1 a S5) do cliente (migration 014). Disponível em todos os clientes.
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

/* ---------- Tag do modelo de contrato (migration 015) ---------- */

export type TagContrato = "ee" | "pontual" | "ee_pontual" | "pontual_assessoria" | "ee_assessoria";

export const TAG_CONTRATO_LABEL: Record<TagContrato, string> = {
  ee: "E.E",
  pontual: "Pontual",
  ee_pontual: "E.E+Pontual",
  pontual_assessoria: "Pontual+Assessoria",
  ee_assessoria: "E.E+Assessoria",
};

const TAG_CONTRATO_COR: Record<TagContrato, string> = {
  ee: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  pontual: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  ee_pontual: "border-orange-500/40 bg-orange-500/15 text-orange-300",
  pontual_assessoria: "border-violet-500/40 bg-violet-500/15 text-violet-300",
  ee_assessoria: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
};

/** Separado das semanas: se a coluna ainda não existir, só essas tags somem. */
export async function carregarTagsContrato(supabase: SupabaseClient): Promise<Record<string, TagContrato>> {
  const { data, error } = await supabase.from("ruston_clientes")
    .select("id, tag_contrato").eq("ativo", true).not("tag_contrato", "is", null);
  if (error) return {};
  const mapa: Record<string, TagContrato> = {};
  (data ?? []).forEach((c: { id: string; tag_contrato: TagContrato }) => { mapa[c.id] = c.tag_contrato; });
  return mapa;
}

export async function salvarTagContrato(supabase: SupabaseClient, clienteId: string, tag: TagContrato | null) {
  const { error } = await supabase.from("ruston_clientes").update({ tag_contrato: tag }).eq("id", clienteId);
  return error;
}

/** Tag "E.E", "Pontual", "E.E+Pontual", "Pontual+Assessoria" ou "E.E+Assessoria". Com onChange vira seletor. */
export function TagContratoCliente({ tag, onChange, size = "sm" }: {
  tag: TagContrato | null | undefined;
  onChange?: (t: TagContrato | null) => void;
  size?: "sm" | "xs";
}) {
  const texto = size === "xs" ? "text-[8px] px-1.5 py-0.5" : "text-[10px] px-1.5 py-0.5";
  if (!onChange) {
    if (!tag) return null;
    return (
      <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border font-bold ${TAG_CONTRATO_COR[tag]} ${texto}`}>
        {TAG_CONTRATO_LABEL[tag]}
      </span>
    );
  }
  return (
    <label className={`relative inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap rounded border font-bold ${texto} ${
      tag ? TAG_CONTRATO_COR[tag] : "border-dashed border-white/20 text-brand-muted hover:text-gray-200"}`}
      title="Modelo de contrato">
      {tag ? TAG_CONTRATO_LABEL[tag] : "+ tag"} <span className="text-[7px]">▼</span>
      <select
        value={tag ?? ""}
        onChange={(e) => onChange((e.target.value || null) as TagContrato | null)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <option value="" className="bg-brand-panel text-gray-100">Sem tag</option>
        {(Object.keys(TAG_CONTRATO_LABEL) as TagContrato[]).map((t) => (
          <option key={t} value={t} className="bg-brand-panel text-gray-100">{TAG_CONTRATO_LABEL[t]}</option>
        ))}
      </select>
    </label>
  );
}
