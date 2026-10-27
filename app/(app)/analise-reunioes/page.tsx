"use client";

import { useEffect, useState } from "react";
import type { AnaliseReuniao } from "@/lib/analiseIA";
import { SelosAnalise, DetalhesAnalise } from "@/components/AnaliseIA";
import { createClient } from "@/lib/supabase/client";

type Cliente = { id: string; nome: string; squad_nome: string | null; coordenador_nome: string | null };
type Analise = AnaliseReuniao;

export default function AnaliseReunioesPage() {
  const supabase = createClient();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [tipoReuniao, setTipoReuniao] = useState("periodica");
  const [titulo, setTitulo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  // "audio" = sobe a gravação · "telefone" = 1:1 por telefone, o coordenador escreve o resumo
  const [modo, setModo] = useState<"audio" | "telefone">("audio");
  const [resumo, setResumo] = useState("");
  const [dataReuniao, setDataReuniao] = useState(new Date().toISOString().slice(0, 10));
  const [duracao, setDuracao] = useState("");
  const [salvo, setSalvo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analisando, setAnalisando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [resultado, setResultado] = useState<Analise | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("ruston_clientes_view")
        .select("id, nome, squad_nome, coordenador_nome")
        .eq("ativo", true)
        .not("etapa", "in", "(cancelado,suspenso)")
        .order("nome");
      setClientes((data ?? []) as Cliente[]);
      setLoading(false);
    }
    load();
  }, []);

  async function analisar1a1() {
    if (resumo.trim().length < 50 || !clienteId) return;
    setAnalisando(true);
    setResultado(null);
    setErro(null);
    setSalvo(false);
    setProgresso("Analisando o resumo com IA...");
    const cliente = clientes.find((c) => c.id === clienteId);
    try {
      const res = await fetch("/api/reuniao-analise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId, cliente_nome: cliente?.nome ?? "", tipo_reuniao: tipoReuniao,
          data_reuniao: dataReuniao, duracao_minutos: duracao, resumo,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErro(data.error ?? "Erro desconhecido");
      } else {
        setResultado(data.analise);
        setSalvo(!!data.saved);
        setResumo("");
        setProgresso("");
      }
    } catch (e: any) {
      setErro(e?.message ?? "Erro de conexao");
    } finally {
      setAnalisando(false);
    }
  }

  async function analisar() {
    if (!arquivo || !clienteId) return;
    setAnalisando(true);
    setResultado(null);
    setErro(null);
    setProgresso("Enviando audio para transcricao...");

    const cliente = clientes.find((c) => c.id === clienteId);
    const formData = new FormData();
    formData.append("audio", arquivo);
    formData.append("cliente_id", clienteId);
    formData.append("cliente_nome", cliente?.nome ?? "");
    formData.append("tipo_reuniao", tipoReuniao);
    formData.append("titulo", titulo);

    try {
      setProgresso("Transcrevendo audio com Whisper...");
      const res = await fetch("/api/reuniao-analise", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || data.error) {
        setErro(data.error ?? "Erro desconhecido");
      } else {
        setResultado(data.analise);
        setProgresso("");
      }
    } catch (e: any) {
      setErro(e?.message ?? "Erro de conexao");
    } finally {
      setAnalisando(false);
    }
  }

  const tempColor = (t: string) => t === "quente" ? "text-emerald-400" : t === "morna" ? "text-yellow-400" : "text-red-400";
  const sentColor = (s: string) => s === "positivo" ? "text-emerald-400" : s === "neutro" ? "text-zinc-400" : "text-red-400";
  const riscoColor = (r: string) => r === "baixo" ? "text-emerald-400" : r === "medio" ? "text-yellow-400" : "text-red-400";

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="text-zinc-400">Carregando...</div></div>;

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Analise de Reunioes com IA</h1>
      <p className="text-zinc-400 text-sm">Suba o audio da reuniao e a IA transcreve, analisa sentimento, identifica decisoes e gera follow-ups automaticamente.</p>

      <div className="flex gap-2">
        {([["audio", "🎙 Áudio da reunião"], ["telefone", "📞 1:1 COO X Cliente"]] as const).map(([k, label]) => (
          <button key={k}
            className={`rounded px-4 py-2 text-sm border ${modo === k ? "bg-blue-600 border-blue-500 text-white" : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
            onClick={() => { setModo(k); setResultado(null); setErro(null); setSalvo(false); }}>
            {label}
          </button>
        ))}
      </div>

      {/* Upload form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Cliente</label>
            <select className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
              value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Selecione o cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Tipo de Reuniao</label>
            <select className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
              value={tipoReuniao} onChange={(e) => setTipoReuniao(e.target.value)}>
              <option value="periodica">Periodica</option>
              <option value="kickoff">Kickoff</option>
              <option value="urgente">Urgente</option>
              <option value="upsell">Upsell</option>
              <option value="renovacao">Renovacao</option>
              <option value="outra">Outra</option>
              <option value="s1">S1</option>
              <option value="s2">S2</option>
              <option value="s3">S3</option>
              <option value="s4">S4</option>
              <option value="s5">S5</option>
            </select>
          </div>
          {modo === "telefone" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Data da ligação</label>
                <input type="date" className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
                  value={dataReuniao} onChange={(e) => setDataReuniao(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Duração (min)</label>
                <input type="number" min={1} className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
                  value={duracao} onChange={(e) => setDuracao(e.target.value)} placeholder="Ex: 20" />
              </div>
            </div>
          ) : (
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Audio da Reuniao</label>
            <input type="file" accept="audio/*,video/*,.webm,.mp4,.m4a,.ogg,.wav,.mp3"
              className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700 file:mr-2 file:bg-zinc-700 file:text-zinc-200 file:border-0 file:rounded file:px-2 file:py-1 file:text-xs"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
          )}
        </div>

        {modo === "audio" && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Título da reunião (opcional)</label>
            <input className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
              value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: E.E S3 - Diagnóstico de Marketing" />
            <p className="mt-1 text-[11px] text-zinc-500">Com E.E ou Estruturação Estratégica no título, a IA também avalia a entrega da semana.</p>
          </div>
        )}

        {modo === "telefone" && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Resumo da conversa</label>
            <textarea rows={8}
              className="w-full bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
              value={resumo} onChange={(e) => setResumo(e.target.value)}
              placeholder="Escreva como foi a ligação: como o cliente está, o que elogiou ou reclamou, como vê o resultado, mudanças no negócio (verba, decisor, lançamentos), se falou de outra agência, o que foi combinado e quem ficou responsável..." />
            <p className="mt-1 text-[11px] text-zinc-500">
              Quanto mais detalhe, melhor a análise. Fica salvo no histórico de Reuniões do cliente, conta na cadência e alimenta o Radar de Churn.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded px-6 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={analisando || !clienteId || (modo === "audio" ? !arquivo : resumo.trim().length < 50)}
            onClick={modo === "audio" ? analisar : analisar1a1}
          >
            {analisando ? "Analisando..." : "Analisar com IA"}
          </button>
          {modo === "audio" && arquivo && <span className="text-zinc-500 text-xs">{arquivo.name} ({(arquivo.size / 1024 / 1024).toFixed(1)} MB)</span>}
          {progresso && <span className="text-blue-400 text-xs animate-pulse">{progresso}</span>}
        </div>

        {salvo && <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-3 text-emerald-300 text-sm">✓ 1:1 salvo no histórico de Reuniões do cliente.</div>}
        {erro && <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-300 text-sm">{erro}</div>}
      </div>

      {/* Resultado */}
      {resultado && (
        <div className="space-y-4">
          {/* Cards resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-400 text-xs uppercase">Temperatura</div>
              <div className={`text-xl font-bold mt-1 capitalize ${tempColor(resultado.temperatura)}`}>{resultado.temperatura}</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-400 text-xs uppercase">Sentimento</div>
              <div className={`text-xl font-bold mt-1 capitalize ${sentColor(resultado.sentimento)}`}>{resultado.sentimento}</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-400 text-xs uppercase">Risco Churn</div>
              <div className={`text-xl font-bold mt-1 capitalize ${riscoColor(resultado.risco_churn)}`}>{resultado.risco_churn}</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-400 text-xs uppercase">Upsell</div>
              <div className={`text-xl font-bold mt-1 capitalize ${resultado.oportunidade_upsell === "clara" ? "text-emerald-400" : resultado.oportunidade_upsell === "possivel" ? "text-blue-400" : "text-zinc-500"}`}>{resultado.oportunidade_upsell}</div>
            </div>
          </div>

          {/* Resumo */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-2">Resumo Executivo</h3>
            <p className="text-zinc-300 text-sm">{resultado.resumo_executivo}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Decisoes */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-2">Decisoes Tomadas</h3>
              {resultado.decisoes.length > 0 ? (
                <ul className="space-y-1">{resultado.decisoes.map((d, i) => <li key={i} className="text-zinc-300 text-sm flex gap-2"><span className="text-emerald-400">✓</span>{d}</li>)}</ul>
              ) : <p className="text-zinc-500 text-sm">Nenhuma decisao identificada</p>}
            </div>

            {/* Compromissos */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-2">Compromissos</h3>
              {resultado.compromissos?.length > 0 ? (
                <ul className="space-y-1">{resultado.compromissos.map((f, i) => (
                  <li key={i} className="text-zinc-300 text-sm flex gap-2">
                    <span className="text-blue-400">→</span>
                    {f.o_que}{f.responsavel ? ` — ${f.responsavel}` : ""}{f.prazo ? ` · até ${f.prazo}` : ""}
                  </li>
                ))}</ul>
              ) : <p className="text-zinc-500 text-sm">Nenhum compromisso identificado</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Sinais positivos */}
            <div className="bg-zinc-900 border border-emerald-500/20 rounded-lg p-4">
              <h3 className="text-emerald-400 font-semibold mb-2">Sinais Positivos</h3>
              {resultado.sinais_positivos.length > 0 ? (
                <ul className="space-y-1">{resultado.sinais_positivos.map((s, i) => <li key={i} className="text-zinc-300 text-sm">🟢 {s}</li>)}</ul>
              ) : <p className="text-zinc-500 text-sm">-</p>}
            </div>

            {/* Sinais negativos */}
            <div className="bg-zinc-900 border border-red-500/20 rounded-lg p-4">
              <h3 className="text-red-400 font-semibold mb-2">Sinais de Alerta</h3>
              {resultado.sinais_negativos.length > 0 ? (
                <ul className="space-y-1">{resultado.sinais_negativos.map((s, i) => <li key={i} className="text-zinc-300 text-sm">🔴 {s}</li>)}</ul>
              ) : <p className="text-zinc-500 text-sm">-</p>}
            </div>
          </div>

          {/* Proximos passos */}
          <div className="bg-zinc-900 border border-blue-500/20 rounded-lg p-4">
            <h3 className="text-blue-400 font-semibold mb-2">Proximos Passos</h3>
            <p className="text-zinc-300 text-sm">{resultado.proximos_passos}</p>
          </div>

          {/* Avaliações extras (estresse, compra, resultado, concorrência, condução...) */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-2">Avaliação do relacionamento</h3>
            <SelosAnalise a={resultado} />
            <DetalhesAnalise a={resultado} />
          </div>

          {/* Topicos */}
          {resultado.topicos_discutidos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {resultado.topicos_discutidos.map((t, i) => (
                <span key={i} className="bg-zinc-800 text-zinc-300 rounded-full px-3 py-1 text-xs">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
