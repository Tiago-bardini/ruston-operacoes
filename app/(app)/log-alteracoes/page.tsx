"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface LogAlteracao {
  id: number;
  criado_em: string;
  usuario_email: string | null;
  tabela: string;
  acao: "inclusao" | "edicao" | "exclusao";
  registro_id: string | null;
  registro_nome: string | null;
  campos_alterados: string[] | null;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
}

// Nome amigável das tabelas (tabela nova sem nome aqui aparece pelo nome técnico)
const TABELA_LABEL: Record<string, string> = {
  ruston_clientes: "Clientes",
  ruston_cliente_planejamento: "Planejamento do cliente",
  ruston_pessoas: "Pessoas",
  ruston_squads: "Squads",
  ruston_fca: "FCA",
  ruston_churn_solicitacoes: "Churn",
  ruston_churn_mrr_base: "Churn · MRR base",
  ruston_forecast: "Forecast",
  ruston_metas_empresa: "Metas da empresa",
  ruston_metas_squad: "Metas do squad",
  ruston_monetizacao_metas: "Monetização · metas",
  ruston_monetizacao_oportunidades: "Monetização · oportunidades",
  ruston_entregas_previstas: "Entregas",
  ruston_tipos_entrega: "Catálogo de entregas",
  ruston_headcount_planejado: "Headcount",
  ruston_reunioes_cliente: "Reuniões",
  ruston_usuario_perfil: "Usuários",
  ruston_ekyte_mapping_pessoa: "Ekyte · vínculos",
  ruston_okr_metas: "OKR · metas",
  ruston_okr_metricas: "OKR · métricas",
  ruston_okr_realizado_investidor: "OKR · realizado",
  ruston_org_areas: "Organograma · áreas",
  ruston_org_carteiras: "Organograma · carteiras",
  ruston_org_pessoas: "Organograma · pessoas",
  ruston_org_subsecoes: "Organograma · subseções",
};

const ACAO_LABEL = { inclusao: "Incluiu", edicao: "Editou", exclusao: "Excluiu" };
const ACAO_COR = {
  inclusao: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  edicao: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  exclusao: "border-red-500/30 bg-red-500/10 text-red-300",
};

const LIMITE = 300;

function hojeMenos(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

export default function LogAlteracoesPage() {
  const supabase = createClient();
  const [logs, setLogs] = useState<LogAlteracao[]>([]);
  const [loading, setLoading] = useState(true);
  const [de, setDe] = useState(hojeMenos(7));
  const [ate, setAte] = useState(new Date().toISOString().slice(0, 10));
  const [tabela, setTabela] = useState("");
  const [usuario, setUsuario] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    let q = supabase.from("ruston_log_alteracoes").select("*")
      .gte("criado_em", `${de}T00:00:00`)
      .lte("criado_em", `${ate}T23:59:59`)
      .order("criado_em", { ascending: false })
      .limit(LIMITE);
    if (tabela) q = q.eq("tabela", tabela);
    const { data } = await q;
    setLogs((data as LogAlteracao[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [de, ate, tabela]);

  const usuarios = useMemo(
    () => Array.from(new Set(logs.map((l) => l.usuario_email ?? "sistema"))).sort(),
    [logs]
  );

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return logs.filter((l) => {
      if (usuario && (l.usuario_email ?? "sistema") !== usuario) return false;
      if (!b) return true;
      return (l.registro_nome ?? "").toLowerCase().includes(b)
        || (l.campos_alterados ?? []).some((c) => c.toLowerCase().includes(b));
    });
  }, [logs, usuario, busca]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Log de alterações</h1>
        <p className="text-sm text-brand-muted">Quem incluiu, editou ou excluiu cada informação do sistema</p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">De</label>
          <input type="date" className="input" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <label className="label">Até</label>
          <input type="date" className="input" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div>
          <label className="label">Módulo</label>
          <select className="input min-w-[200px]" value={tabela} onChange={(e) => setTabela(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TABELA_LABEL).sort((a, b) => a[1].localeCompare(b[1]))
              .map(([t, l]) => <option key={t} value={t}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Usuário</label>
          <select className="input min-w-[200px]" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="label">Buscar</label>
          <input className="input" placeholder="Nome do registro ou campo..." value={busca}
            onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && filtrados.length === 0 && (
        <div className="card text-center text-brand-muted">Nenhuma alteração no período.</div>
      )}

      {!loading && filtrados.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-4 py-3">Quando</th>
                <th className="px-4 py-3">Quem</th>
                <th className="px-4 py-3">Ação</th>
                <th className="px-4 py-3">Módulo</th>
                <th className="px-4 py-3">Registro</th>
                <th className="px-4 py-3">Campos</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <FragmentoLog key={l.id} l={l} aberto={aberto === l.id}
                  onToggle={() => setAberto(aberto === l.id ? null : l.id)} />
              ))}
            </tbody>
          </table>
          {logs.length === LIMITE && (
            <p className="border-t border-white/5 px-4 py-2 text-[11px] text-brand-muted">
              Mostrando as {LIMITE} alterações mais recentes — diminua o período ou filtre o módulo pra ver as anteriores.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FragmentoLog({ l, aberto, onToggle }: { l: LogAlteracao; aberto: boolean; onToggle: () => void }) {
  const campos = l.campos_alterados ?? [];
  return (
    <>
      <tr className="cursor-pointer border-b border-white/5 hover:bg-white/[0.02]" onClick={onToggle}>
        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-brand-muted">
          {new Date(l.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
        </td>
        <td className="px-4 py-2.5 text-xs">{l.usuario_email ?? <span className="text-brand-muted">sistema</span>}</td>
        <td className="px-4 py-2.5"><span className={`badge ${ACAO_COR[l.acao]}`}>{ACAO_LABEL[l.acao]}</span></td>
        <td className="px-4 py-2.5 text-xs text-brand-muted">{TABELA_LABEL[l.tabela] ?? l.tabela}</td>
        <td className="px-4 py-2.5 font-medium">{l.registro_nome ?? <span className="text-brand-muted">—</span>}</td>
        <td className="px-4 py-2.5 text-xs text-brand-muted">
          {l.acao === "edicao" ? campos.join(", ") : "registro completo"} <span className="ml-1">{aberto ? "▾" : "▸"}</span>
        </td>
      </tr>
      {aberto && (
        <tr className="border-b border-white/5 bg-black/20">
          <td colSpan={6} className="px-4 py-3">
            {l.acao === "edicao" ? (
              <div className="space-y-2">
                {campos.map((c) => (
                  <div key={c} className="grid grid-cols-[180px_1fr_1fr] gap-3 text-xs">
                    <span className="font-semibold text-gray-300">{c}</span>
                    <Valor v={l.antes?.[c]} cor="text-red-300/80" />
                    <Valor v={l.depois?.[c]} cor="text-emerald-300" />
                  </div>
                ))}
                <p className="text-[10px] text-brand-muted">vermelho = antes · verde = depois</p>
              </div>
            ) : (
              <Valor v={l.acao === "inclusao" ? l.depois : l.antes} cor="text-gray-300" />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Valor({ v, cor }: { v: unknown; cor: string }) {
  const texto = v == null ? "(vazio)" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
  return <pre className={`max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] ${cor}`}>{texto}</pre>;
}
