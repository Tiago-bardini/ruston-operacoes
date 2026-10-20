"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Analise = {
  dados_cliente?: { nome_empresa?: string; segmento?: string; regiao?: string; site?: string; redes_sociais?: string[]; tempo_mercado?: string; porte?: string };
  diagnostico_closer?: { analise_site?: string; analise_anuncios?: string; analise_redes_sociais?: string; analise_seo?: string; pontos_fortes?: string[]; pontos_fracos?: string[]; dados_apresentados?: string[] };
  o_que_foi_vendido?: { servico: string; descricao?: string; valor_mensal?: string; valor_setup?: string; prazo_entrega?: string; frequencia?: string }[];
  valores?: { mrr_total?: string; setup_total?: string; investimento_midia?: string; desconto_aplicado?: string; prazo_contrato?: string; forma_pagamento?: string };
  condicoes_especiais?: string[];
  dores_cliente?: string[];
  metas_cliente?: string[];
  metricas_cliente?: { faturamento?: string; ticket_medio?: string; qtd_clientes_atuais?: string; investimento_atual_marketing?: string; custo_aquisicao_cliente?: string; taxa_conversao?: string };
  concorrentes?: { mencionados_na_call?: { nome: string; contexto: string; url_site?: string }[]; sugeridos_pela_ia?: { nome: string; motivo: string; o_que_pesquisar: string }[] };
  insights_operacionais?: string[];
  brief_operacional?: string;
  alertas?: string[];
};

type Squad = { id: string; nome: string };
type Pessoa = { id: string; nome: string; cargo: string | null; squad_id: string | null };
type TipoEntrega = { id: string; nome: string; categoria: string };

export default function AuditoriaVendasPage() {
  const supabase = createClient();
  const [clienteNome, setClienteNome] = useState("");
  const [callFiles, setCallFiles] = useState<(File | null)[]>([null]);
  const [callNames, setCallNames] = useState<string[]>([""]);
  const [contrato, setContrato] = useState("");
  const [contratoPdf, setContratoPdf] = useState<File | null>(null);
  const [contratoLink, setContratoLink] = useState("");
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
      const servicosVendidos = (resultado.o_que_foi_vendido ?? []).map((s) => s.servico);
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

  function addCall() { setCallFiles([...callFiles, null]); setCallNames([...callNames, ""]); }
  function removeCall(i: number) { setCallFiles(callFiles.filter((_, idx) => idx !== i)); setCallNames(callNames.filter((_, idx) => idx !== i)); }
  function updateCallFile(i: number, file: File | null) {
    setCallFiles(callFiles.map((f, idx) => idx === i ? file : f));
    setCallNames(callNames.map((n, idx) => idx === i ? (file?.name ?? "") : n));
  }

  const callsComArquivo = callFiles.filter((f) => f !== null);

  async function extractTextFromPdf(file: File): Promise<string> {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item: any) => item.str).join(" ");
      pages.push(text);
    }
    return pages.join("\n");
  }

  async function analisar() {
    if (!callsComArquivo.length || !clienteNome.trim()) return;
    setAnalisando(true);
    setResultado(null);
    setErro(null);
    setProgresso(`Lendo ${callsComArquivo.length} transcricao(oes)...`);

    try {
      // Extrair texto de cada arquivo no client-side
      const transcricoes: string[] = [];
      for (let i = 0; i < callFiles.length; i++) {
        const file = callFiles[i];
        if (!file) continue;
        setProgresso(`Lendo arquivo ${i + 1} de ${callsComArquivo.length}...`);

        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          const text = await extractTextFromPdf(file);
          transcricoes.push(`[Call ${i + 1} - ${file.name}]\n${text}`);
        } else {
          const text = await file.text();
          transcricoes.push(`[Call ${i + 1} - ${file.name}]\n${text}`);
        }
      }

      setProgresso("Analisando com IA...");

      // Enviar texto extraido (nao os arquivos)
      const formData = new FormData();
      formData.append("cliente_nome", clienteNome);
      formData.append("transcricao_texto", transcricoes.join("\n\n---\n\n"));

      // Contrato
      if (contratoPdf) {
        setProgresso("Lendo contrato PDF...");
        const contratoText = await extractTextFromPdf(contratoPdf);
        formData.append("contrato", contratoText);
      } else if (contrato.trim()) {
        formData.append("contrato", contrato);
      }
      if (contratoLink.trim()) formData.append("contrato_link", contratoLink);

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
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Nome do Cliente / Lead</label>
          <input type="text" className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
            value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} placeholder="Ex: Empresa ABC" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs text-zinc-400">Transcricoes das Calls de Vendas (PDF ou TXT)</label>
            <button type="button" className="text-xs text-blue-400 hover:text-blue-300" onClick={addCall}>+ Adicionar outra call</button>
          </div>
          {callFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[10px] text-zinc-500 font-medium whitespace-nowrap">Call {i + 1}</span>
              <input type="file" accept=".pdf,.txt,.doc,.docx,text/plain,application/pdf"
                className="flex-1 bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700 file:mr-2 file:bg-zinc-700 file:text-zinc-200 file:border-0 file:rounded file:px-2 file:py-1 file:text-xs"
                onChange={(e) => updateCallFile(i, e.target.files?.[0] ?? null)} />
              {file && <span className="text-zinc-500 text-[10px] truncate max-w-[120px]">{file.name}</span>}
              {callFiles.length > 1 && (
                <button type="button" className="text-[10px] text-red-400 hover:text-red-300 whitespace-nowrap" onClick={() => removeCall(i)}>remover</button>
              )}
            </div>
          ))}
          <p className="text-[10px] text-zinc-600">{callsComArquivo.length} arquivo(s) selecionado(s)</p>
        </div>

        <div className="space-y-3">
          <label className="block text-xs text-zinc-400">Contrato (opcional — para confrontar com o que foi vendido)</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">Upload PDF do contrato</label>
              <input type="file" accept=".pdf,application/pdf"
                className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700 file:mr-2 file:bg-zinc-700 file:text-zinc-200 file:border-0 file:rounded file:px-2 file:py-1 file:text-xs"
                onChange={(e) => setContratoPdf(e.target.files?.[0] ?? null)} />
              {contratoPdf && <span className="text-zinc-500 text-xs">{contratoPdf.name}</span>}
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">Ou link do contrato (Google Drive, etc.)</label>
              <input type="url" className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
                value={contratoLink} onChange={(e) => setContratoLink(e.target.value)}
                placeholder="https://drive.google.com/..." />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">Ou cole o texto</label>
              <textarea className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700" rows={2}
                value={contrato} onChange={(e) => setContrato(e.target.value)}
                placeholder="Cole clausulas principais..." />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-blue-600 hover:bg-blue-700 text-white rounded px-6 py-2 text-sm font-medium disabled:opacity-50"
            disabled={analisando || !callsComArquivo.length || !clienteNome.trim()} onClick={analisar}>
            {analisando ? "Analisando..." : "Auditar Call"}
          </button>
          {progresso && <span className="text-blue-400 text-xs animate-pulse">{progresso}</span>}
        </div>
        {erro && <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-300 text-sm">{erro}</div>}
      </div>

      {resultado && (
        <div className="space-y-4">
          {/* Brief Operacional */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-5">
            <h3 className="text-blue-400 font-bold text-lg mb-2">Brief Operacional</h3>
            <p className="text-zinc-200 text-sm">{resultado.brief_operacional}</p>
          </div>

          {/* Alertas */}
          {(resultado.alertas ?? []).length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <h3 className="text-red-400 font-semibold mb-2">Alertas</h3>
              <ul className="space-y-1">{(resultado.alertas ?? []).map((a, i) => <li key={i} className="text-zinc-300 text-sm">⚠ {a}</li>)}</ul>
            </div>
          )}

          {/* Dados do Cliente */}
          {resultado.dados_cliente && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-2">Dados do Cliente</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                {resultado.dados_cliente.segmento && <div><span className="text-zinc-500">Segmento:</span> <span className="text-zinc-200">{resultado.dados_cliente.segmento}</span></div>}
                {resultado.dados_cliente.regiao && <div><span className="text-zinc-500">Regiao:</span> <span className="text-zinc-200">{resultado.dados_cliente.regiao}</span></div>}
                {resultado.dados_cliente.porte && <div><span className="text-zinc-500">Porte:</span> <span className="text-zinc-200">{resultado.dados_cliente.porte}</span></div>}
                {resultado.dados_cliente.site && <div><span className="text-zinc-500">Site:</span> <span className="text-blue-300">{resultado.dados_cliente.site}</span></div>}
                {resultado.dados_cliente.tempo_mercado && <div><span className="text-zinc-500">Tempo:</span> <span className="text-zinc-200">{resultado.dados_cliente.tempo_mercado}</span></div>}
              </div>
              {(resultado.dados_cliente.redes_sociais ?? []).length > 0 && <div className="mt-2 flex gap-2 flex-wrap">{resultado.dados_cliente.redes_sociais!.map((r, i) => <span key={i} className="bg-zinc-800 text-zinc-300 rounded-full px-2 py-0.5 text-xs">{r}</span>)}</div>}
            </div>
          )}

          {/* Diagnostico do Closer */}
          {resultado.diagnostico_closer && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4">
              <h3 className="text-purple-400 font-bold mb-3">Diagnostico do Closer (Cliente Oculto)</h3>
              <div className="space-y-3 text-sm">
                {resultado.diagnostico_closer.analise_site && <div><span className="text-zinc-400 font-medium">Site:</span> <span className="text-zinc-200">{resultado.diagnostico_closer.analise_site}</span></div>}
                {resultado.diagnostico_closer.analise_anuncios && <div><span className="text-zinc-400 font-medium">Anuncios:</span> <span className="text-zinc-200">{resultado.diagnostico_closer.analise_anuncios}</span></div>}
                {resultado.diagnostico_closer.analise_redes_sociais && <div><span className="text-zinc-400 font-medium">Redes Sociais:</span> <span className="text-zinc-200">{resultado.diagnostico_closer.analise_redes_sociais}</span></div>}
                {resultado.diagnostico_closer.analise_seo && <div><span className="text-zinc-400 font-medium">SEO:</span> <span className="text-zinc-200">{resultado.diagnostico_closer.analise_seo}</span></div>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                {(resultado.diagnostico_closer.pontos_fortes ?? []).length > 0 && <div>{resultado.diagnostico_closer.pontos_fortes!.map((p, i) => <p key={i} className="text-emerald-300 text-sm">✅ {p}</p>)}</div>}
                {(resultado.diagnostico_closer.pontos_fracos ?? []).length > 0 && <div>{resultado.diagnostico_closer.pontos_fracos!.map((p, i) => <p key={i} className="text-red-300 text-sm">❌ {p}</p>)}</div>}
              </div>
              {(resultado.diagnostico_closer.dados_apresentados ?? []).length > 0 && <div className="mt-2 pt-2 border-t border-zinc-800"><p className="text-zinc-500 text-xs mb-1">Dados apresentados:</p>{resultado.diagnostico_closer.dados_apresentados!.map((d, i) => <p key={i} className="text-zinc-300 text-xs">📊 {d}</p>)}</div>}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* O que foi vendido */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-white font-bold mb-2">O que foi Vendido</h3>
              {(resultado.o_que_foi_vendido ?? []).map((s, i) => (
                <div key={i} className="py-2 border-b border-zinc-800 last:border-0 text-sm">
                  <div className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-zinc-200 font-medium">{s.servico}</span></div>
                  {s.descricao && <p className="text-zinc-400 text-xs ml-5">{s.descricao}</p>}
                  <div className="flex gap-3 ml-5 mt-1 text-xs">
                    {s.valor_mensal && <span className="text-emerald-300">{s.valor_mensal}/mes</span>}
                    {s.valor_setup && <span className="text-amber-300">Setup: {s.valor_setup}</span>}
                    {s.prazo_entrega && <span className="text-zinc-500">Prazo: {s.prazo_entrega}</span>}
                    {s.frequencia && <span className="text-zinc-500">{s.frequencia}</span>}
                  </div>
                </div>
              ))}
              {resultado.valores && (
                <div className="mt-3 pt-2 border-t border-zinc-700 space-y-1 text-sm">
                  {resultado.valores.mrr_total && <div className="text-zinc-400">MRR Total: <span className="text-emerald-400 font-bold">{resultado.valores.mrr_total}</span></div>}
                  {resultado.valores.setup_total && <div className="text-zinc-400">Setup: <span className="text-amber-300">{resultado.valores.setup_total}</span></div>}
                  {resultado.valores.investimento_midia && <div className="text-zinc-400">Midia: <span className="text-blue-300">{resultado.valores.investimento_midia}</span></div>}
                  {resultado.valores.prazo_contrato && <div className="text-zinc-400">Contrato: <span className="text-zinc-200">{resultado.valores.prazo_contrato}</span></div>}
                  {resultado.valores.desconto_aplicado && <div className="text-zinc-400">Desconto: <span className="text-amber-300">{resultado.valores.desconto_aplicado}</span></div>}
                </div>
              )}
            </div>

            {/* Dores e Metas */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-white font-bold mb-2">Dores do Cliente</h3>
              {(resultado.dores_cliente ?? []).map((d, i) => <p key={i} className="text-zinc-300 text-sm">💢 {d}</p>)}
              {(resultado.metas_cliente ?? []).length > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-800">
                  <p className="text-white font-semibold text-sm mb-1">Metas</p>
                  {resultado.metas_cliente!.map((m, i) => <p key={i} className="text-zinc-300 text-sm">🎯 {m}</p>)}
                </div>
              )}
              {resultado.metricas_cliente && Object.values(resultado.metricas_cliente).some(Boolean) && (
                <div className="mt-3 pt-3 border-t border-zinc-800">
                  <p className="text-white font-semibold text-sm mb-1">Metricas</p>
                  {resultado.metricas_cliente.faturamento && <p className="text-zinc-300 text-sm">Faturamento: {resultado.metricas_cliente.faturamento}</p>}
                  {resultado.metricas_cliente.ticket_medio && <p className="text-zinc-300 text-sm">Ticket medio: {resultado.metricas_cliente.ticket_medio}</p>}
                  {resultado.metricas_cliente.qtd_clientes_atuais && <p className="text-zinc-300 text-sm">Clientes: {resultado.metricas_cliente.qtd_clientes_atuais}</p>}
                  {resultado.metricas_cliente.investimento_atual_marketing && <p className="text-zinc-300 text-sm">Investimento: {resultado.metricas_cliente.investimento_atual_marketing}</p>}
                </div>
              )}
            </div>
          </div>

          {/* Concorrentes */}
          <div className="bg-zinc-900 border border-amber-500/20 rounded-lg p-4">
            <h3 className="text-amber-400 font-bold mb-3">Concorrentes</h3>
            {(resultado.concorrentes?.mencionados_na_call ?? []).length > 0 && (
              <div className="mb-3">
                <p className="text-zinc-400 text-xs font-semibold mb-1">Mencionados na call:</p>
                {resultado.concorrentes!.mencionados_na_call!.map((c, i) => (
                  <div key={i} className="text-sm py-1"><span className="text-zinc-200 font-medium">{c.nome}</span> {c.url_site && <span className="text-blue-300 text-xs">({c.url_site})</span>}<p className="text-zinc-400 text-xs">{c.contexto}</p></div>
                ))}
              </div>
            )}
            {(resultado.concorrentes?.sugeridos_pela_ia ?? []).length > 0 && (
              <div className="pt-3 border-t border-zinc-800">
                <p className="text-amber-300 text-xs font-semibold mb-1">Sugeridos pela IA (pesquisar):</p>
                {resultado.concorrentes!.sugeridos_pela_ia!.map((c, i) => (
                  <div key={i} className="text-sm py-1 border-b border-zinc-800/50 last:border-0">
                    <span className="text-zinc-200 font-medium">{c.nome}</span>
                    <p className="text-zinc-500 text-xs">{c.motivo}</p>
                    <p className="text-amber-300/70 text-xs">🔍 {c.o_que_pesquisar}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Insights Operacionais */}
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
            <h3 className="text-emerald-400 font-bold mb-2">Insights para o Time Operacional</h3>
            <ul className="space-y-1">{(resultado.insights_operacionais ?? []).map((ins, idx) => <li key={idx} className="text-zinc-300 text-sm">💡 {ins}</li>)}</ul>
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
                    value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder={resultado.valores?.mrr_total ?? "0"} />
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
