"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Analise = {
  promessas_vendidas: { item: string; valor: string | null; prazo: string | null }[];
  servicos_mencionados: string[];
  valores_mencionados: { mrr: string | null; setup: string | null; investimento_midia: string | null };
  condicoes_especiais: string[];
  auditoria_contrato?: { conformidades: string[]; divergencias: string[]; extras_contrato: string[]; risco: string };
  concorrentes_mencionados: { nome: string; contexto: string }[];
  dores_cliente: string[];
  metas_cliente: string[];
  metricas_cliente: { faturamento: string | null; ticket_medio: string | null; qtd_clientes: string | null; investimento_atual: string | null };
  insights_operacionais: string[];
  pesquisa_concorrentes: { nome: string; o_que_pesquisar: string }[];
  brief_operacional: string;
  alertas: string[];
};

type Squad = { id: string; nome: string };
type Pessoa = { id: string; nome: string; cargo: string | null; squad_id: string | null };
type TipoEntrega = { id: string; nome: string; categoria: string };

export default function AuditoriaVendasPage() {
  const supabase = createClient();
  const [clienteNome, setClienteNome] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [contrato, setContrato] = useState("");
  const [analisando, setAnalisando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [resultado, setResultado] = useState<Analise | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [tiposEntrega, setTiposEntrega] = useState<TipoEntrega[]>([]);
  const [squadId, setSquadId] = useState("");
  const [coordId, setCoordId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [mrr, setMrr] = useState("");
  const [cadastrando, setCadastrando] = useState(false);
  const [cadastroOk, setCadastroOk] = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: sq }, { data: ps }, { data: te }] = await Promise.all([
        supabase.from("ruston_squads").select("id, nome").eq("ativo", true).order("nome"),
        supabase.from("ruston_pessoas").select("id, nome, cargo, squad_id").eq("ativo", true).order("nome"),
        supabase.from("ruston_tipos_entrega").select("id, nome, categoria").eq("ativo", true).order("ordem"),
      ]);
      setSquads((sq ?? []) as Squad[]);
      setPessoas((ps ?? []) as Pessoa[]);
      setTiposEntrega((te ?? []) as TipoEntrega[]);
    }
    load();
  }, []);

  const coordenadores = pessoas.filter((p) => p.cargo === "coordenador" || p.cargo === "gerente");
  const gestores = pessoas.filter((p) => p.cargo === "gestor_projetos");

  async function cadastrarCliente() {
    if (!resultado || !clienteNome.trim() || !squadId) return;
    setCadastrando(true);
    try {
      // 1. Criar cliente
      const { data: cliente, error: cErr } = await supabase.from("ruston_clientes").insert({
        nome: clienteNome.trim().toUpperCase(),
        etapa: "onboarding",
        mrr: mrr ? Number(mrr) : null,
        squad_id: squadId,
        coordenador_id: coordId || null,
        account_id: accountId || null,
        ativo: true,
        data_assinatura: new Date().toISOString().slice(0, 10),
      }).select("id").single();

      if (cErr || !cliente) throw new Error(cErr?.message ?? "Erro ao criar cliente");

      // 2. Match servicos vendidos com tipos de entrega e criar entregas
      const servicosVendidos = resultado.servicos_mencionados ?? [];
      const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const entregasCriadas: string[] = [];
      for (const servico of servicosVendidos) {
        const sNorm = normalizar(servico);
        const match = tiposEntrega.find((t) => {
          const tNorm = normalizar(t.nome);
          return tNorm.includes(sNorm) || sNorm.includes(tNorm)
            || sNorm.split(/\s+/).some((p) => p.length > 3 && tNorm.includes(p));
        });
        if (match) {
          await supabase.from("ruston_entregas_previstas").insert({
            cliente_id: cliente.id,
            tipo_entrega_id: match.id,
            ativo: true,
            observacoes: `Identificado na call de vendas: "${servico}"`,
          });
          entregasCriadas.push(match.nome);
        }
      }

      setCadastroOk(true);
      setErro(null);
      alert(`Cliente "${clienteNome}" cadastrado com ${entregasCriadas.length} entregaveis!\n\n${entregasCriadas.length > 0 ? "Entregas: " + entregasCriadas.join(", ") : "Nenhum servico mapeado automaticamente — verifique manualmente na aba Entregas."}`);
    } catch (e: any) {
      setErro(`Erro ao cadastrar: ${e?.message}`);
    } finally {
      setCadastrando(false);
    }
  }

  async function analisar() {
    if (!arquivo || !clienteNome.trim()) return;
    setAnalisando(true);
    setResultado(null);
    setErro(null);
    setProgresso("Transcrevendo audio da call...");

    const formData = new FormData();
    formData.append("audio", arquivo);
    formData.append("cliente_nome", clienteNome);
    if (contrato.trim()) formData.append("contrato", contrato);

    try {
      const res = await fetch("/api/auditoria-vendas", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErro(data.error ?? "Erro desconhecido");
      } else {
        setResultado(data.analise);
      }
    } catch (e: any) {
      setErro(e?.message ?? "Erro de conexao");
    } finally {
      setAnalisando(false);
      setProgresso("");
    }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Auditoria de Vendas</h1>
      <p className="text-zinc-400 text-sm">Suba o audio da call de vendas. A IA extrai o que foi vendido, confronta com o contrato e gera insights para o time operacional.</p>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Nome do Cliente / Lead</label>
            <input type="text" className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
              value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} placeholder="Ex: Empresa ABC" />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Audio da Call de Vendas</label>
            <input type="file" accept="audio/*,video/*,.webm,.mp4,.m4a,.ogg,.wav,.mp3"
              className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700 file:mr-2 file:bg-zinc-700 file:text-zinc-200 file:border-0 file:rounded file:px-2 file:py-1 file:text-xs"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Contrato (opcional — cole o texto do contrato para confrontar)</label>
          <textarea className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700" rows={4}
            value={contrato} onChange={(e) => setContrato(e.target.value)}
            placeholder="Cole aqui o texto do contrato ou as clausulas principais. Se nao tiver, deixe vazio — a IA analisa so a call." />
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-blue-600 hover:bg-blue-700 text-white rounded px-6 py-2 text-sm font-medium disabled:opacity-50"
            disabled={analisando || !arquivo || !clienteNome.trim()} onClick={analisar}>
            {analisando ? "Analisando..." : "Auditar Call"}
          </button>
          {arquivo && <span className="text-zinc-500 text-xs">{arquivo.name} ({(arquivo.size / 1024 / 1024).toFixed(1)} MB)</span>}
          {progresso && <span className="text-blue-400 text-xs animate-pulse">{progresso}</span>}
        </div>
        {erro && <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-300 text-sm">{erro}</div>}
      </div>

      {resultado && (
        <div className="space-y-4">
          {/* Brief Operacional */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <h3 className="text-blue-400 font-semibold mb-2">Brief Operacional</h3>
            <p className="text-zinc-200 text-sm">{resultado.brief_operacional}</p>
          </div>

          {/* Alertas */}
          {resultado.alertas.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <h3 className="text-red-400 font-semibold mb-2">Alertas</h3>
              <ul className="space-y-1">{resultado.alertas.map((a, i) => <li key={i} className="text-zinc-300 text-sm">⚠ {a}</li>)}</ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* O que foi vendido */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-2">O que foi Vendido</h3>
              {resultado.promessas_vendidas.map((p, i) => (
                <div key={i} className="flex gap-2 text-sm py-1 border-b border-zinc-800 last:border-0">
                  <span className="text-emerald-400">✓</span>
                  <div>
                    <span className="text-zinc-200">{p.item}</span>
                    {p.valor && <span className="text-amber-300 ml-2">({p.valor})</span>}
                    {p.prazo && <span className="text-zinc-500 ml-2">Prazo: {p.prazo}</span>}
                  </div>
                </div>
              ))}
              {resultado.valores_mencionados.mrr && <div className="mt-2 text-sm text-zinc-400">MRR: <span className="text-emerald-400 font-medium">{resultado.valores_mencionados.mrr}</span></div>}
              {resultado.valores_mencionados.setup && <div className="text-sm text-zinc-400">Setup: <span className="text-amber-300">{resultado.valores_mencionados.setup}</span></div>}
              {resultado.valores_mencionados.investimento_midia && <div className="text-sm text-zinc-400">Midia: <span className="text-blue-300">{resultado.valores_mencionados.investimento_midia}</span></div>}
            </div>

            {/* Auditoria Contrato */}
            {resultado.auditoria_contrato ? (
              <div className={`bg-zinc-900 border rounded-lg p-4 ${resultado.auditoria_contrato.risco === "alto" ? "border-red-500/40" : resultado.auditoria_contrato.risco === "medio" ? "border-yellow-500/40" : "border-emerald-500/40"}`}>
                <h3 className="text-white font-semibold mb-2">Auditoria do Contrato
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${resultado.auditoria_contrato.risco === "alto" ? "bg-red-500/20 text-red-300" : resultado.auditoria_contrato.risco === "medio" ? "bg-yellow-500/20 text-yellow-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                    Risco {resultado.auditoria_contrato.risco}
                  </span>
                </h3>
                {resultado.auditoria_contrato.divergencias.length > 0 && (
                  <div className="mb-2">
                    <p className="text-red-400 text-xs font-semibold mb-1">Vendido mas NAO esta no contrato:</p>
                    {resultado.auditoria_contrato.divergencias.map((d, i) => <p key={i} className="text-zinc-300 text-sm">🔴 {d}</p>)}
                  </div>
                )}
                {resultado.auditoria_contrato.conformidades.length > 0 && (
                  <div className="mb-2">
                    <p className="text-emerald-400 text-xs font-semibold mb-1">Conforme:</p>
                    {resultado.auditoria_contrato.conformidades.map((c, i) => <p key={i} className="text-zinc-300 text-sm">🟢 {c}</p>)}
                  </div>
                )}
                {resultado.auditoria_contrato.extras_contrato.length > 0 && (
                  <div>
                    <p className="text-zinc-400 text-xs font-semibold mb-1">No contrato mas nao mencionado na call:</p>
                    {resultado.auditoria_contrato.extras_contrato.map((e, i) => <p key={i} className="text-zinc-400 text-sm">⚪ {e}</p>)}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <h3 className="text-white font-semibold mb-2">Servicos Mencionados</h3>
                <div className="flex flex-wrap gap-2">{resultado.servicos_mencionados.map((s, i) => <span key={i} className="bg-zinc-800 text-zinc-300 rounded-full px-3 py-1 text-xs">{s}</span>)}</div>
                {resultado.condicoes_especiais.length > 0 && (
                  <div className="mt-3"><p className="text-amber-400 text-xs font-semibold mb-1">Condicoes especiais:</p>
                    {resultado.condicoes_especiais.map((c, i) => <p key={i} className="text-zinc-300 text-sm">⭐ {c}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Concorrentes */}
            <div className="bg-zinc-900 border border-amber-500/20 rounded-lg p-4">
              <h3 className="text-amber-400 font-semibold mb-2">Concorrentes Identificados</h3>
              {resultado.concorrentes_mencionados.length > 0 ? (
                <div className="space-y-2">
                  {resultado.concorrentes_mencionados.map((c, i) => (
                    <div key={i} className="text-sm">
                      <span className="text-zinc-200 font-medium">{c.nome}</span>
                      <p className="text-zinc-400 text-xs">{c.contexto}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="text-zinc-500 text-sm">Nenhum concorrente mencionado</p>}
              {resultado.pesquisa_concorrentes.length > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-800">
                  <p className="text-xs text-zinc-400 font-semibold mb-1">O que pesquisar:</p>
                  {resultado.pesquisa_concorrentes.map((p, i) => (
                    <div key={i} className="text-sm mt-1">
                      <span className="text-zinc-300">{p.nome}:</span>
                      <span className="text-zinc-500 ml-1">{p.o_que_pesquisar}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dores e Metas */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-2">Dores do Cliente</h3>
              {resultado.dores_cliente.map((d, i) => <p key={i} className="text-zinc-300 text-sm">💢 {d}</p>)}
              {resultado.metas_cliente.length > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-800">
                  <p className="text-white font-semibold text-sm mb-1">Metas</p>
                  {resultado.metas_cliente.map((m, i) => <p key={i} className="text-zinc-300 text-sm">🎯 {m}</p>)}
                </div>
              )}
              {Object.values(resultado.metricas_cliente).some(Boolean) && (
                <div className="mt-3 pt-3 border-t border-zinc-800">
                  <p className="text-white font-semibold text-sm mb-1">Metricas</p>
                  {resultado.metricas_cliente.faturamento && <p className="text-zinc-300 text-sm">Faturamento: {resultado.metricas_cliente.faturamento}</p>}
                  {resultado.metricas_cliente.ticket_medio && <p className="text-zinc-300 text-sm">Ticket medio: {resultado.metricas_cliente.ticket_medio}</p>}
                  {resultado.metricas_cliente.qtd_clientes && <p className="text-zinc-300 text-sm">Qtd clientes: {resultado.metricas_cliente.qtd_clientes}</p>}
                  {resultado.metricas_cliente.investimento_atual && <p className="text-zinc-300 text-sm">Investimento atual: {resultado.metricas_cliente.investimento_atual}</p>}
                </div>
              )}
            </div>
          </div>

          {/* Insights Operacionais */}
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
            <h3 className="text-emerald-400 font-semibold mb-2">Insights para o Time Operacional</h3>
            <ul className="space-y-1">{resultado.insights_operacionais.map((i, idx) => <li key={idx} className="text-zinc-300 text-sm">💡 {i}</li>)}</ul>
          </div>

          {/* Cadastrar Cliente + Entregas */}
          {!cadastroOk && (
            <div className="bg-zinc-900 border-2 border-blue-500/30 rounded-lg p-6">
              <h3 className="text-white font-bold text-lg mb-1">Cadastrar Cliente no Sistema</h3>
              <p className="text-zinc-400 text-sm mb-4">Cria o cliente em onboarding e os entregaveis automaticamente na aba Entregas.</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Squad</label>
                  <select className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
                    value={squadId} onChange={(e) => setSquadId(e.target.value)}>
                    <option value="">Selecione</option>
                    {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Coordenador</label>
                  <select className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
                    value={coordId} onChange={(e) => setCoordId(e.target.value)}>
                    <option value="">Selecione</option>
                    {coordenadores.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Gestor de Projetos</label>
                  <select className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
                    value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">Selecione</option>
                    {gestores.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">MRR (R$)</label>
                  <input type="number" className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
                    value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder={resultado.valores_mencionados.mrr ?? "0"} />
                </div>
              </div>
              <button className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-6 py-2 text-sm font-medium disabled:opacity-50"
                disabled={cadastrando || !squadId}
                onClick={cadastrarCliente}>
                {cadastrando ? "Cadastrando..." : "Cadastrar Cliente + Entregas"}
              </button>
            </div>
          )}

          {cadastroOk && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
              <p className="text-emerald-400 font-bold text-lg">Cliente cadastrado com sucesso!</p>
              <p className="text-zinc-400 text-sm">Verifique na aba Clientes (onboarding) e na aba Entregas.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
