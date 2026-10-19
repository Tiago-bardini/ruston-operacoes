"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  FcaView, FcaAvaliacao, Squad, ClienteView, BandeiraFca, StatusFca,
} from "@/lib/types";
import {
  MESES_LABEL, CRITERIOS_FCA, calcularNotaFinalFca, bandeiraDaNota,
  BANDEIRA_FCA_COLOR, BANDEIRA_FCA_LABEL, STATUS_FCA_COLOR, STATUS_FCA_LABEL,
  sextaDaSemanaFca, formatSemanaFca, ultimasSextas, formatDate,
} from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

type Aba = "avaliar" | "detalhes" | "consolidado";

export default function FcaPage() {
  const supabase = createClient();
  const { isGerente, squadId: perfilSquadId } = useUsuarioPerfil();
  const [aba, setAba] = useState<Aba>("avaliar");
  const [dataRef, setDataRef] = useState<string>(sextaDaSemanaFca());
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<FcaView[]>([]);
  const [historico, setHistorico] = useState<FcaView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSquad, setFilterSquad] = useState<string>("");
  const [filterBandeira, setFilterBandeira] = useState<BandeiraFca | "">("");
  const [filterStatus, setFilterStatus] = useState<StatusFca | "">("");
  const [modalCliente, setModalCliente] = useState<ClienteView | null>(null);
  const [importando, setImportando] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [jsonText, setJsonText] = useState("");

  const sextas = useMemo(() => ultimasSextas(24), []);

  // Modelo de JSON (usado nos botões "Baixar modelo" e "Copiar exemplo")
  const MODELO_JSON = useMemo(() => {
    const exemplo = [
      {
        cliente_nome: "Nome do Cliente 1",
        data_referencia: dataRef,
        nota_resultado: 8,
        nota_operacao_trafego: 7.5,
        nota_prazo: 9,
        nota_qualidade: 8,
        nota_relacionamento: 9,
        nota_roi: 7,
        fato: "Campanha de leads superou meta em 15% na semana. Cliente aprovou criativos no mesmo dia.",
        causa: "Boa segmentação da campanha + alinhamento semanal fixo com o cliente funcionando.",
        acao: "Manter cadência atual, propor expansão de verba pro próximo mês.",
        observacoes: "",
        status: "rascunho",
      },
      {
        cliente_nome: "Nome do Cliente 2",
        nota_resultado: 5,
        nota_operacao_trafego: 6,
        nota_prazo: 4,
        nota_qualidade: 7,
        nota_relacionamento: 6,
        nota_roi: 5,
        fato: "Cliente reclamou do atraso na entrega da LP. CPL subiu 30% na semana.",
        causa: "Fila de design travada, falta de aprovação de material pelo cliente no prazo.",
        acao: "Reunião de alinhamento emergencial segunda-feira; revisar fluxo de aprovação.",
        status: "rascunho",
      },
    ];
    return JSON.stringify(exemplo, null, 2);
  }, [dataRef]);

  function baixarModelo() {
    const blob = new Blob([MODELO_JSON], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelo-fca-${dataRef}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copiarExemplo() {
    try {
      await navigator.clipboard.writeText(MODELO_JSON);
      setImportResult("✓ Exemplo copiado! Agora é só colar no bloco abaixo e ajustar os dados.");
    } catch {
      setImportResult("Não deu pra copiar automaticamente. Seleciona o texto do modelo acima e copia manualmente.");
    }
  }

  async function importarDoTexto() {
    if (!jsonText.trim()) {
      setImportResult("⚠️ Cola o JSON no bloco acima primeiro.");
      return;
    }
    // Transforma o texto num "arquivo" fake pra reaproveitar a função importarJSON
    const fakeFile = new File([jsonText], "colado.json", { type: "application/json" });
    await importarJSON(fakeFile);
    setJsonText(""); // limpa depois de importar
  }

  // -----------------------------------------------------------------------
  // Importar JSON em lote
  // -----------------------------------------------------------------------
  // Formato esperado:
  // [
  //   {
  //     "cliente_nome": "ABC Marketing",   // ou "cliente_id": "uuid"
  //     "data_referencia": "2026-10-09",   // opcional, usa dataRef se omitir
  //     "nota_resultado": 8,
  //     "nota_operacao_trafego": 7,
  //     "nota_prazo": 9,
  //     "nota_qualidade": 8,
  //     "nota_relacionamento": 8,
  //     "nota_roi": 7,
  //     "fato": "...",
  //     "causa": "...",
  //     "acao": "...",
  //     "observacoes": "...",
  //     "status": "rascunho" | "aguardando_validacao" | "validado"
  //   }
  // ]
  async function importarJSON(file: File) {
    setImportando(true);
    setImportResult(null);
    let ok = 0, err = 0;
    const erros: string[] = [];
    try {
      const txt = await file.text();
      const raw = JSON.parse(txt);
      const itens: any[] = Array.isArray(raw) ? raw : (raw.itens ?? raw.data ?? [raw]);

      for (const it of itens) {
        try {
          // Resolver cliente_id — match flexível por nome
          let clienteId = it.cliente_id as string | undefined;
          if (!clienteId && it.cliente_nome) {
            const normalizar = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const nomeBusca = normalizar(String(it.cliente_nome));
            // 1) Match exato
            const match = clientes.find((c) => normalizar(c.nome) === nomeBusca)
            // 2) Nome cadastrado contem o buscado (ex: "Anotashow / Nubba" contem "anotashow")
                       ?? clientes.find((c) => normalizar(c.nome).includes(nomeBusca))
            // 3) Nome buscado contem o cadastrado (ex: "anotashow nubba" contem "anotashow")
                       ?? clientes.find((c) => nomeBusca.includes(normalizar(c.nome)))
            // 4) Alguma parte do nome (split por / , - |) bate
                       ?? clientes.find((c) => {
                            const partes = normalizar(c.nome).split(/[\s]*[\/\|\-,][\s]*/);
                            return partes.some((p) => p.length > 2 && (nomeBusca.includes(p) || p.includes(nomeBusca)));
                          });
            clienteId = match?.id;
          }
          if (!clienteId) {
            erros.push(`cliente não encontrado: ${it.cliente_nome ?? "(sem nome)"}`);
            err++;
            continue;
          }

          const dRef = it.data_referencia ?? dataRef;
          const d = new Date(dRef + "T00:00:00");

          const payload: any = {
            cliente_id: clienteId,
            data_referencia: dRef,
            ano: d.getFullYear(),
            mes: d.getMonth() + 1,
            nota_resultado:        it.nota_resultado        ?? it.resultado        ?? null,
            nota_operacao_trafego: it.nota_operacao_trafego ?? it.operacao_trafego ?? it.operacao ?? null,
            nota_prazo:            it.nota_prazo            ?? it.prazo            ?? null,
            nota_qualidade:        it.nota_qualidade        ?? it.qualidade        ?? null,
            nota_relacionamento:   it.nota_relacionamento   ?? it.relacionamento   ?? null,
            nota_roi:              it.nota_roi              ?? it.roi              ?? null,
            fato:  it.fato  ?? null,
            causa: it.causa ?? null,
            acao:  it.acao  ?? null,
            observacoes: it.observacoes ?? null,
            status: it.status ?? "rascunho",
          };

          // Já existe? Atualiza. Se não, insere.
          const { data: existente } = await supabase
            .from("ruston_fca")
            .select("id")
            .eq("cliente_id", clienteId)
            .eq("data_referencia", dRef)
            .maybeSingle();

          if (existente?.id) {
            const { error } = await supabase.from("ruston_fca").update(payload).eq("id", existente.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from("ruston_fca").insert(payload);
            if (error) throw error;
          }
          ok++;
        } catch (e: any) {
          err++;
          erros.push(`${it.cliente_nome ?? it.cliente_id ?? "?"}: ${e?.message ?? e}`);
        }
      }

      setImportResult(
        `✓ ${ok} importado(s), ${err} erro(s)${erros.length ? "\n\nErros:\n" + erros.slice(0, 5).join("\n") : ""}`
      );
      await load();
    } catch (e: any) {
      setImportResult(`Erro ao ler JSON: ${e?.message ?? e}`);
    } finally {
      setImportando(false);
    }
  }

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: sq }, { data: fs }, { data: fh }] = await Promise.all([
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_fca_view").select("*").eq("data_referencia", dataRef),
      supabase.from("ruston_fca_view").select("*").in("data_referencia", sextas.slice(0, 12)),
    ]);
    setClientes((cs as ClienteView[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    setAvaliacoes((fs as FcaView[]) ?? []);
    setHistorico((fh as FcaView[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dataRef]);

  const getAvaliacao = (clienteId: string) =>
    avaliacoes.find((a) => a.cliente_id === clienteId);

  const filtered = useMemo(() => {
    return clientes.filter((c) => {
      // Coordenador/Investidor só vê clientes do próprio squad
      if (!isGerente && perfilSquadId && c.squad_id !== perfilSquadId) return false;
      if (filterSquad && c.squad_id !== filterSquad) return false;
      const av = getAvaliacao(c.id);
      const bandeira: BandeiraFca = av?.bandeira ?? "sem_dado";
      if (filterBandeira && bandeira !== filterBandeira) return false;
      const status: StatusFca | "sem" = av?.status ?? "sem" as any;
      if (filterStatus && status !== filterStatus) return false;
      return true;
    });
  // eslint-disable-next-line
  }, [clientes, avaliacoes, filterSquad, filterBandeira, filterStatus, isGerente, perfilSquadId]);

  const stats = useMemo(() => {
    const verde = filtered.filter((c) => getAvaliacao(c.id)?.bandeira === "verde").length;
    const amarelo = filtered.filter((c) => getAvaliacao(c.id)?.bandeira === "amarelo").length;
    const vermelho = filtered.filter((c) => getAvaliacao(c.id)?.bandeira === "vermelho").length;
    const validados = filtered.filter((c) => getAvaliacao(c.id)?.status === "validado").length;
    return { verde, amarelo, vermelho, validados, total: filtered.length };
  // eslint-disable-next-line
  }, [filtered, avaliacoes]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">FCA — Fato · Causa · Ação</h1>
        <p className="text-sm text-brand-muted">
          Avaliação semanal (sáb→sex) por cliente
        </p>
      </div>

      <div className="mb-6 inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
        {[
          { v: "avaliar",     label: "Avaliar semana" },
          { v: "detalhes",    label: "Vista detalhada" },
          { v: "consolidado", label: "Consolidado" },
        ].map((it) => (
          <button
            key={it.v}
            onClick={() => setAba(it.v as Aba)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
              aba === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      {aba === "avaliar" && (
        <>
          {/* Filtros */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select className="input max-w-[220px]" value={dataRef} onChange={(e) => setDataRef(e.target.value)}>
              {sextas.map((s) => (
                <option key={s} value={s}>
                  {formatSemanaFca(s)} ({formatDate(s)})
                </option>
              ))}
            </select>
            <select className="input max-w-[160px]" value={filterSquad} onChange={(e) => setFilterSquad(e.target.value)}>
              <option value="">Todos squads</option>
              {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
            <select className="input max-w-[140px]" value={filterBandeira} onChange={(e) => setFilterBandeira(e.target.value as BandeiraFca | "")}>
              <option value="">Todas bandeiras</option>
              <option value="verde">🟢 Safe</option>
              <option value="amarelo">🟡 Care</option>
              <option value="vermelho">🔴 Danger</option>
              <option value="sem_dado">⚪ Sem dado</option>
            </select>
            <select className="input max-w-[180px]" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as StatusFca | "")}>
              <option value="">Todos status</option>
              <option value="rascunho">Rascunho</option>
              <option value="aguardando_validacao">Aguardando validação</option>
              <option value="validado">Validado</option>
            </select>

            {/* Importar JSON em lote */}
            <button
              className="btn-ghost ml-auto"
              onClick={() => setShowImportPanel((v) => !v)}
            >
              {showImportPanel ? "✕ Fechar importação" : "📤 Importar JSON"}
            </button>
          </div>

          {/* Painel de importação */}
          {showImportPanel && (
            <div className="mb-4 rounded-lg border border-brand/30 bg-brand-panel/50 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-2">📤 Importar FCAs em lote via JSON</h3>
                <p className="text-xs text-brand-muted">
                  Dá pra importar várias avaliações de uma vez. Baixa o modelo abaixo, preenche com os dados dos clientes e cola ou envia aqui.
                </p>
              </div>

              {/* Botões de ajuda */}
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost text-xs" onClick={baixarModelo}>
                  💾 Baixar modelo (.json)
                </button>
                <button className="btn-ghost text-xs" onClick={copiarExemplo}>
                  📋 Copiar exemplo
                </button>
                <label className="btn-ghost text-xs cursor-pointer">
                  📁 Enviar arquivo
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    disabled={importando}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importarJSON(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {/* Modelo visível */}
              <details className="rounded-md border border-white/10 bg-black/20">
                <summary className="cursor-pointer p-2 text-xs text-brand-muted hover:text-white">
                  👁️ Ver modelo do JSON (clica pra expandir)
                </summary>
                <pre className="p-3 text-[11px] text-emerald-200 overflow-x-auto max-h-64 overflow-y-auto">
{MODELO_JSON}
                </pre>
              </details>

              {/* Explicação dos campos */}
              <details className="rounded-md border border-white/10 bg-black/20">
                <summary className="cursor-pointer p-2 text-xs text-brand-muted hover:text-white">
                  📖 O que cada campo significa
                </summary>
                <div className="p-3 text-[11px] space-y-1">
                  <p><span className="text-brand font-semibold">cliente_nome</span> — nome exato do cliente (igual ao cadastrado). <span className="text-amber-300">Obrigatório</span>.</p>
                  <p><span className="text-brand font-semibold">data_referencia</span> — sexta-feira da semana no formato <code className="bg-white/10 px-1 rounded">YYYY-MM-DD</code>. Se omitir, usa a semana selecionada no filtro.</p>
                  <p><span className="text-brand font-semibold">nota_resultado</span>, <span className="text-brand font-semibold">nota_operacao_trafego</span>, <span className="text-brand font-semibold">nota_prazo</span>, <span className="text-brand font-semibold">nota_qualidade</span>, <span className="text-brand font-semibold">nota_relacionamento</span>, <span className="text-brand font-semibold">nota_roi</span> — notas de 0 a 10 (aceita decimal, ex: 7.5).</p>
                  <p><span className="text-brand font-semibold">fato</span> — o que aconteceu na semana.</p>
                  <p><span className="text-brand font-semibold">causa</span> — por que aconteceu.</p>
                  <p><span className="text-brand font-semibold">acao</span> — o que vamos fazer.</p>
                  <p><span className="text-brand font-semibold">observacoes</span> — opcional.</p>
                  <p><span className="text-brand font-semibold">status</span> — <code className="bg-white/10 px-1 rounded">rascunho</code>, <code className="bg-white/10 px-1 rounded">aguardando_validacao</code> ou <code className="bg-white/10 px-1 rounded">validado</code>. Default: rascunho.</p>
                  <p className="mt-2 text-brand-muted italic">💡 Se já existe FCA pro mesmo cliente+semana, ele é atualizado. Senão, cria novo.</p>
                </div>
              </details>

              {/* Textarea pra colar */}
              <div>
                <label className="label">Ou cola o JSON aqui:</label>
                <textarea
                  className="input font-mono text-xs"
                  rows={10}
                  placeholder='Cola o JSON aqui. Ex: [{"cliente_nome": "ABC", "nota_resultado": 8, ...}]'
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                />
                <button
                  className="btn mt-2"
                  disabled={importando || !jsonText.trim()}
                  onClick={importarDoTexto}
                >
                  {importando ? "⏳ Importando..." : "✓ Importar JSON colado"}
                </button>
              </div>
            </div>
          )}

          {importResult && (
            <div className="mb-4 rounded-lg border border-brand/30 bg-brand-panel/50 p-3">
              <div className="flex items-start justify-between gap-3">
                <pre className="text-xs text-white whitespace-pre-wrap flex-1">{importResult}</pre>
                <button onClick={() => setImportResult(null)}
                  className="text-brand-muted hover:text-white text-sm">×</button>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Total" valor={stats.total} cor="text-white" />
            <StatCard label="Safe" valor={stats.verde} cor="text-emerald-300" />
            <StatCard label="Care" valor={stats.amarelo} cor="text-amber-300" />
            <StatCard label="Danger" valor={stats.vermelho} cor="text-red-300" />
            <StatCard label="Validados" valor={stats.validados} cor="text-emerald-300" sublabel={`de ${stats.total}`} />
          </div>

          {loading && <p className="text-brand-muted">Carregando...</p>}

          {!loading && filtered.length === 0 && (
            <div className="card text-center py-12">
              <p className="text-brand-muted">Nenhum cliente nesse filtro.</p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((c) => {
                const av = getAvaliacao(c.id);
                return (
                  <FcaCard
                    key={c.id}
                    cliente={c}
                    avaliacao={av}
                    onAbrir={() => setModalCliente(c)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {aba === "detalhes" && (
        <TabDetalhes
          dataRef={dataRef}
          sextas={sextas}
          setDataRef={setDataRef}
          clientes={filtered}
          getAvaliacao={getAvaliacao}
          onAbrir={(c) => setModalCliente(c)}
        />
      )}

      {aba === "consolidado" && (
        <TabConsolidado
          historico={historico}
          clientes={clientes}
          squads={squads}
          sextas={sextas.slice(0, 12)}
          isGerente={isGerente}
          perfilSquadId={perfilSquadId}
        />
      )}

      {modalCliente && (
        <FcaModal
          cliente={modalCliente}
          avaliacao={getAvaliacao(modalCliente.id)}
          dataRef={dataRef}
          historicoCliente={historico.filter((h) => h.cliente_id === modalCliente.id)
            .sort((a, b) => (b.data_referencia > a.data_referencia ? 1 : -1))}
          onFechar={() => setModalCliente(null)}
          onSalvo={() => { setModalCliente(null); load(); }}
        />
      )}
    </div>
  );
}

/* ============================== STATS CARD ============================== */

function StatCard({ label, valor, cor, sublabel }: {
  label: string; valor: number; cor: string; sublabel?: string;
}) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${cor}`}>{valor}</p>
      {sublabel && <p className="text-[10px] text-brand-muted">{sublabel}</p>}
    </div>
  );
}

/* ============================== FCA CARD ============================== */

function FcaCard({ cliente, avaliacao, onAbrir }: {
  cliente: ClienteView;
  avaliacao?: FcaView;
  onAbrir: () => void;
}) {
  const bandeira: BandeiraFca = avaliacao?.bandeira ?? "sem_dado";
  const nota = avaliacao?.nota_final;
  const status: StatusFca | null = avaliacao?.status ?? null;

  return (
    <button onClick={onAbrir}
      className="card text-left hover:border-brand transition group">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="font-medium">{cliente.nome}</p>
          <p className="text-[10px] text-brand-muted">
            {cliente.squad_nome ?? "sem squad"} · GP: {cliente.account_nome ?? "—"}
          </p>
        </div>
        <span className={`badge ${BANDEIRA_FCA_COLOR[bandeira]}`}>
          {BANDEIRA_FCA_LABEL[bandeira]}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">Nota final</p>
          <p className={`text-3xl font-bold ${
            bandeira === "verde"    ? "text-emerald-300" :
            bandeira === "amarelo"  ? "text-amber-300" :
            bandeira === "vermelho" ? "text-red-300" :
            "text-brand-muted"
          }`}>
            {nota != null ? nota.toFixed(2) : "—"}
          </p>
        </div>
        {status && (
          <span className={`badge ${STATUS_FCA_COLOR[status]}`}>
            {STATUS_FCA_LABEL[status]}
          </span>
        )}
      </div>

      <p className="mt-3 text-[10px] text-brand hover:text-red-300 opacity-70 group-hover:opacity-100">
        {avaliacao ? "editar avaliação →" : "+ avaliar cliente"}
      </p>
    </button>
  );
}

/* ============================== TAB DETALHES ============================== */

function TabDetalhes({ dataRef, sextas, setDataRef, clientes, getAvaliacao, onAbrir }: {
  dataRef: string;
  sextas: string[];
  setDataRef: (s: string) => void;
  clientes: ClienteView[];
  getAvaliacao: (id: string) => FcaView | undefined;
  onAbrir: (c: ClienteView) => void;
}) {
  const clientesComFca = clientes.filter((c) => getAvaliacao(c.id));

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <select className="input max-w-[240px]" value={dataRef} onChange={(e) => setDataRef(e.target.value)}>
          {sextas.map((s) => (
            <option key={s} value={s}>
              {formatSemanaFca(s)} ({formatDate(s)})
            </option>
          ))}
        </select>
        <span className="text-xs text-brand-muted">
          {clientesComFca.length} de {clientes.length} clientes preenchidos
        </span>
      </div>

      {clientesComFca.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-brand-muted">
            Nenhum FCA preenchido pra {formatSemanaFca(dataRef)}. Volte pra aba "Avaliar semana" pra começar.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {clientesComFca.map((c) => {
          const av = getAvaliacao(c.id)!;
          return (
            <div key={c.id} className={`card border ${BANDEIRA_FCA_COLOR[av.bandeira]}`}>
              {/* Cabeçalho */}
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="text-lg font-bold">{c.nome}</p>
                  <p className="text-[10px] text-brand-muted">
                    {c.squad_nome ?? "sem squad"} · GP: {c.account_nome ?? "—"} ·
                    Preenchido por: {av.preenchido_por_nome ?? "—"}
                    {av.validado_por_nome ? ` · Validado por: ${av.validado_por_nome}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${STATUS_FCA_COLOR[av.status]}`}>
                    {STATUS_FCA_LABEL[av.status]}
                  </span>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-brand-muted">Nota</p>
                    <p className={`text-2xl font-bold ${
                      av.bandeira === "verde"    ? "text-emerald-300" :
                      av.bandeira === "amarelo"  ? "text-amber-300" :
                      av.bandeira === "vermelho" ? "text-red-300" :
                      "text-brand-muted"
                    }`}>
                      {av.nota_final?.toFixed(2) ?? "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Notas por critério */}
              <div className="mb-3 grid grid-cols-3 gap-2 md:grid-cols-6">
                {CRITERIOS_FCA.map((crit) => {
                  const nota = (av as any)[crit.chave] as number | null;
                  return (
                    <div key={crit.chave} className="rounded bg-white/5 p-2 text-center">
                      <p className="text-[9px] uppercase tracking-wide text-brand-muted">{crit.label}</p>
                      <p className={`text-lg font-bold ${
                        nota == null ? "text-brand-muted" :
                        nota >= 8 ? "text-emerald-300" :
                        nota >= 6 ? "text-amber-300" :
                        "text-red-300"
                      }`}>
                        {nota != null ? nota.toFixed(1) : "—"}
                      </p>
                      <p className="text-[9px] text-brand-muted">peso {crit.peso}</p>
                    </div>
                  );
                })}
              </div>

              {/* Fato, Causa, Ação */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded bg-white/5 p-3">
                  <p className="mb-1 text-[9px] uppercase tracking-wide text-brand-muted">📌 Fato</p>
                  <p className="text-xs whitespace-pre-wrap">
                    {av.fato || <span className="italic text-brand-muted/60">Não preenchido</span>}
                  </p>
                </div>
                <div className="rounded bg-white/5 p-3">
                  <p className="mb-1 text-[9px] uppercase tracking-wide text-brand-muted">❓ Causa</p>
                  <p className="text-xs whitespace-pre-wrap">
                    {av.causa || <span className="italic text-brand-muted/60">Não preenchido</span>}
                  </p>
                </div>
                <div className="rounded bg-white/5 p-3">
                  <p className="mb-1 text-[9px] uppercase tracking-wide text-brand-muted">✅ Ação</p>
                  <p className="text-xs whitespace-pre-wrap">
                    {av.acao || <span className="italic text-brand-muted/60">Não preenchido</span>}
                  </p>
                </div>
              </div>

              {av.observacoes && (
                <div className="mt-3 rounded bg-white/5 p-3">
                  <p className="mb-1 text-[9px] uppercase tracking-wide text-brand-muted">📝 Observações</p>
                  <p className="text-xs whitespace-pre-wrap">{av.observacoes}</p>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[10px] text-brand-muted">
                  Última atualização: {new Date(av.updated_at).toLocaleString("pt-BR")}
                </span>
                <button
                  onClick={() => onAbrir(c)}
                  className="text-xs text-brand hover:text-red-400"
                >Editar avaliação →</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== TAB CONSOLIDADO ============================== */

function TabConsolidado({ historico, clientes, squads, sextas, isGerente, perfilSquadId }: {
  historico: FcaView[];
  clientes: ClienteView[];
  squads: Squad[];
  sextas: string[];
  isGerente: boolean;
  perfilSquadId: string | null;
}) {
  const hist = useMemo(() => {
    // Coordenador/Investidor: filtra pelo squad
    if (!isGerente && perfilSquadId) {
      return historico.filter((h) => h.cliente_squad_id === perfilSquadId);
    }
    return historico;
  }, [historico, isGerente, perfilSquadId]);

  // Distribuição de bandeiras por semana (12 últimas)
  const evolucaoSemanas = sextas.map((s) => {
    const doDia = hist.filter((h) => h.data_referencia === s);
    return {
      semana: s,
      total: doDia.length,
      verde: doDia.filter((h) => h.bandeira === "verde").length,
      amarelo: doDia.filter((h) => h.bandeira === "amarelo").length,
      vermelho: doDia.filter((h) => h.bandeira === "vermelho").length,
    };
  }).reverse(); // mais antiga primeiro

  // Semana mais recente pra análise de critério
  const semanaAtual = sextas[0];
  const doAtual = hist.filter((h) => h.data_referencia === semanaAtual);

  // Média por critério (semana atual)
  const criteriosMedias = CRITERIOS_FCA.map((crit) => {
    const notas = doAtual
      .map((h) => (h as any)[crit.chave] as number | null)
      .filter((n) => n != null) as number[];
    const media = notas.length > 0 ? notas.reduce((a, b) => a + b, 0) / notas.length : null;
    const baixos = notas.filter((n) => n < 6).length;
    return { crit, media, baixos, total: notas.length };
  });

  // Clientes com maior recorrência de nota baixa (últimas 4 semanas)
  const ultimasQuatro = sextas.slice(0, 4);
  const clientesAtencao = useMemo(() => {
    const map = new Map<string, { nome: string; squad: string; vermelhas: number; amarelas: number }>();
    hist
      .filter((h) => ultimasQuatro.includes(h.data_referencia))
      .forEach((h) => {
        if (!h.cliente_nome) return;
        const atual = map.get(h.cliente_id) ?? {
          nome: h.cliente_nome,
          squad: squads.find((s) => s.id === h.cliente_squad_id)?.nome ?? "—",
          vermelhas: 0, amarelas: 0,
        };
        if (h.bandeira === "vermelho") atual.vermelhas++;
        if (h.bandeira === "amarelo") atual.amarelas++;
        map.set(h.cliente_id, atual);
      });
    return Array.from(map.entries())
      .filter(([_, v]) => v.vermelhas > 0 || v.amarelas >= 2)
      .sort((a, b) => (b[1].vermelhas - a[1].vermelhas) || (b[1].amarelas - a[1].amarelas))
      .slice(0, 10);
  }, [hist, ultimasQuatro, squads]);

  return (
    <div className="space-y-6">
      {/* Semana atual — resumo dos critérios */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">
          📊 Semana atual — {formatSemanaFca(semanaAtual)} · média por critério
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {criteriosMedias.map(({ crit, media, baixos, total }) => (
            <div key={crit.chave} className="card p-3">
              <p className="text-[10px] uppercase tracking-wide text-brand-muted">{crit.label}</p>
              <p className={`mt-1 text-2xl font-bold ${
                media == null ? "text-brand-muted" :
                media >= 8 ? "text-emerald-300" :
                media >= 6 ? "text-amber-300" :
                "text-red-300"
              }`}>
                {media != null ? media.toFixed(1) : "—"}
              </p>
              <p className="mt-1 text-[10px] text-brand-muted">
                {baixos > 0 ? (
                  <span className="text-red-300">{baixos} c/ nota &lt; 6</span>
                ) : (
                  `${total} avaliados`
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Evolução das últimas 12 semanas */}
      <div className="card">
        <p className="mb-4 text-sm font-semibold">📈 Evolução das 12 últimas semanas</p>
        <div className="flex items-end gap-1 h-40">
          {evolucaoSemanas.map((s) => {
            const total = s.total || 1;
            const maxTotal = Math.max(...evolucaoSemanas.map((x) => x.total), 1);
            const alturaTotal = (s.total / maxTotal) * 100;
            return (
              <div key={s.semana} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full flex-1 flex items-end" style={{ minHeight: 100 }}>
                  <div className="w-full flex flex-col" style={{ height: `${alturaTotal}%` }}>
                    {s.verde > 0 && (
                      <div className="bg-emerald-500/70" style={{ flex: s.verde / total }}
                        title={`${s.verde} verde`} />
                    )}
                    {s.amarelo > 0 && (
                      <div className="bg-amber-500/70" style={{ flex: s.amarelo / total }}
                        title={`${s.amarelo} amarelo`} />
                    )}
                    {s.vermelho > 0 && (
                      <div className="bg-red-500/70" style={{ flex: s.vermelho / total }}
                        title={`${s.vermelho} vermelho`} />
                    )}
                  </div>
                </div>
                <p className="text-[9px] text-brand-muted">{formatSemanaFca(s.semana).replace("Sex. ", "")}</p>
                <p className="text-[9px] text-white font-medium">{s.total}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Clientes que precisam de atenção */}
      <div className="card">
        <p className="mb-3 text-sm font-semibold">⚠️ Clientes com padrão de nota baixa (últimas 4 semanas)</p>
        {clientesAtencao.length === 0 && (
          <p className="text-xs text-brand-muted">Nenhum cliente com padrão preocupante nas últimas 4 semanas.</p>
        )}
        {clientesAtencao.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="py-2">Cliente</th>
                <th className="py-2">Squad</th>
                <th className="py-2 text-center w-24">🔴 Danger</th>
                <th className="py-2 text-center w-24">🟡 Care</th>
              </tr>
            </thead>
            <tbody>
              {clientesAtencao.map(([id, dados]) => (
                <tr key={id} className="border-b border-white/5 last:border-0">
                  <td className="py-2 font-medium">{dados.nome}</td>
                  <td className="py-2 text-brand-muted">{dados.squad}</td>
                  <td className="py-2 text-center text-red-300 font-semibold">{dados.vermelhas || "—"}</td>
                  <td className="py-2 text-center text-amber-300">{dados.amarelas || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================== MODAL DE AVALIAÇÃO ============================== */

const emptyAvaliacao = {
  nota_resultado: "",
  nota_operacao_trafego: "",
  nota_prazo: "",
  nota_qualidade: "",
  nota_relacionamento: "",
  nota_roi: "",
  fato: "",
  causa: "",
  acao: "",
  status: "rascunho" as StatusFca,
  observacoes: "",
};

function FcaModal({ cliente, avaliacao, dataRef, historicoCliente, onFechar, onSalvo }: {
  cliente: ClienteView;
  avaliacao?: FcaView;
  dataRef: string;
  historicoCliente: FcaView[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const supabase = createClient();
  const { isGerente, isCoordenador } = useUsuarioPerfil();
  const podeValidar = isGerente || isCoordenador;
  const [form, setForm] = useState(emptyAvaliacao);
  const [saving, setSaving] = useState(false);
  const [temOportunidade, setTemOportunidade] = useState(false);
  const [opForm, setOpForm] = useState({ titulo: "", valor_mrr: "", valor_onetime: "", descricao: "" });

  useEffect(() => {
    if (avaliacao) {
      setForm({
        nota_resultado: avaliacao.nota_resultado != null ? String(avaliacao.nota_resultado) : "",
        nota_operacao_trafego: avaliacao.nota_operacao_trafego != null ? String(avaliacao.nota_operacao_trafego) : "",
        nota_prazo: avaliacao.nota_prazo != null ? String(avaliacao.nota_prazo) : "",
        nota_qualidade: avaliacao.nota_qualidade != null ? String(avaliacao.nota_qualidade) : "",
        nota_relacionamento: avaliacao.nota_relacionamento != null ? String(avaliacao.nota_relacionamento) : "",
        nota_roi: avaliacao.nota_roi != null ? String(avaliacao.nota_roi) : "",
        fato: avaliacao.fato ?? "",
        causa: avaliacao.causa ?? "",
        acao: avaliacao.acao ?? "",
        status: avaliacao.status,
        observacoes: avaliacao.observacoes ?? "",
      });
    } else {
      setForm(emptyAvaliacao);
    }
    setTemOportunidade(false);
    setOpForm({ titulo: "", valor_mrr: "", valor_onetime: "", descricao: "" });
  }, [avaliacao]);

  const notaCalculada = useMemo(() => {
    const notas = {
      nota_resultado: form.nota_resultado === "" ? null : Number(form.nota_resultado),
      nota_operacao_trafego: form.nota_operacao_trafego === "" ? null : Number(form.nota_operacao_trafego),
      nota_prazo: form.nota_prazo === "" ? null : Number(form.nota_prazo),
      nota_qualidade: form.nota_qualidade === "" ? null : Number(form.nota_qualidade),
      nota_relacionamento: form.nota_relacionamento === "" ? null : Number(form.nota_relacionamento),
      nota_roi: form.nota_roi === "" ? null : Number(form.nota_roi),
    };
    return calcularNotaFinalFca(notas);
  }, [form]);

  const bandeira = bandeiraDaNota(notaCalculada);

  async function salvar(novoStatus?: StatusFca) {
    setSaving(true);
    const d = new Date(dataRef + "T00:00:00");
    const payload: Partial<FcaAvaliacao> = {
      cliente_id: cliente.id,
      data_referencia: dataRef,
      ano: d.getFullYear(),
      mes: d.getMonth() + 1,
      nota_resultado:        form.nota_resultado        === "" ? null : Number(form.nota_resultado),
      nota_operacao_trafego: form.nota_operacao_trafego === "" ? null : Number(form.nota_operacao_trafego),
      nota_prazo:            form.nota_prazo            === "" ? null : Number(form.nota_prazo),
      nota_qualidade:        form.nota_qualidade        === "" ? null : Number(form.nota_qualidade),
      nota_relacionamento:   form.nota_relacionamento   === "" ? null : Number(form.nota_relacionamento),
      nota_roi:              form.nota_roi              === "" ? null : Number(form.nota_roi),
      fato:  form.fato  || null,
      causa: form.causa || null,
      acao:  form.acao  || null,
      status: novoStatus ?? form.status,
      observacoes: form.observacoes || null,
    };
    if (novoStatus === "validado") {
      payload.validado_at = new Date().toISOString();
    }
    if (avaliacao) {
      await supabase.from("ruston_fca").update(payload).eq("id", avaliacao.id);
    } else {
      await supabase.from("ruston_fca").insert(payload);
    }

    // Criar oportunidade de monetizacao se marcada
    if (temOportunidade && opForm.titulo.trim()) {
      await supabase.from("ruston_monetizacao_oportunidades").insert({
        cliente_id: cliente.id,
        titulo: opForm.titulo.trim(),
        descricao: opForm.descricao.trim() || null,
        estagio: "ideia",
        valor_mrr_estimado: opForm.valor_mrr ? Number(opForm.valor_mrr) : 0,
        valor_onetime_estimado: opForm.valor_onetime ? Number(opForm.valor_onetime) : 0,
        probabilidade: 30,
        observacoes: `Identificado no FCA de ${dataRef}`,
      });
    }

    setSaving(false);
    onSalvo();
  }

  async function remover() {
    if (!avaliacao) return;
    if (!confirm("Remover essa avaliação?")) return;
    await supabase.from("ruston_fca").delete().eq("id", avaliacao.id);
    onSalvo();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={onFechar}>
      <div className="w-full max-w-3xl rounded-xl bg-brand-panel p-6 shadow-lg my-8 max-h-[calc(100vh-4rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold">{cliente.nome}</h3>
            <p className="text-xs text-brand-muted">
              FCA · {formatSemanaFca(dataRef)} ({formatDate(dataRef)}) · {cliente.squad_nome ?? "sem squad"}
            </p>
          </div>
          <button onClick={onFechar} className="text-brand-muted hover:text-gray-200 text-xl">×</button>
        </div>

        {/* Histórico do cliente (linha do tempo) */}
        {historicoCliente.length > 0 && (
          <div className="mb-4 rounded-lg bg-white/5 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-brand-muted">Histórico recente</p>
            <div className="flex flex-wrap gap-1">
              {historicoCliente.slice(0, 12).reverse().map((h) => (
                <div key={h.id} title={`${formatSemanaFca(h.data_referencia)} · Nota ${h.nota_final?.toFixed(2) ?? "—"}`}
                  className={`h-6 w-16 rounded flex items-center justify-center text-[9px] font-semibold ${
                    h.bandeira === "verde"    ? "bg-emerald-500/40 text-emerald-100" :
                    h.bandeira === "amarelo"  ? "bg-amber-500/40 text-amber-100" :
                    h.bandeira === "vermelho" ? "bg-red-500/40 text-red-100" :
                    "bg-white/5 text-brand-muted"
                  }`}>
                  {h.nota_final?.toFixed(1) ?? "—"}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nota final em destaque */}
        <div className={`mb-6 rounded-xl border p-4 ${BANDEIRA_FCA_COLOR[bandeira]}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide opacity-70">Nota final calculada</p>
              <p className="text-4xl font-bold">
                {notaCalculada != null ? notaCalculada.toFixed(2) : "—"}
              </p>
            </div>
            <span className="badge">{BANDEIRA_FCA_LABEL[bandeira]}</span>
          </div>
        </div>

        {/* 6 critérios com tooltips */}
        <div className="mb-4">
          <p className="mb-3 text-sm font-semibold">Notas por critério (0 a 10)</p>
          <p className="mb-3 text-[10px] text-brand-muted">💡 Passe o mouse em cima de cada critério para ver o que avaliar</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {CRITERIOS_FCA.map((c) => (
              <div key={c.chave}>
                <label className="label group relative cursor-help inline-flex items-center gap-1">
                  <span className="underline decoration-dotted decoration-brand-muted underline-offset-4">
                    {c.label}
                  </span>
                  <span className="text-[9px] text-brand-muted">peso {c.peso}</span>
                  {/* Tooltip */}
                  <div className="pointer-events-none invisible group-hover:visible absolute z-50 left-0 top-6 w-72 rounded-lg border border-brand/40 bg-brand-panel p-3 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="mb-2 text-xs font-semibold text-brand">{c.label}</p>
                    <p className="text-[11px] text-white whitespace-pre-line leading-relaxed">
                      {c.descricao}
                    </p>
                  </div>
                </label>
                <input
                  type="number" min="0" max="10" step="0.1"
                  className="input"
                  value={(form as any)[c.chave]}
                  onChange={(e) => setForm({ ...form, [c.chave]: e.target.value })}
                  placeholder="0-10"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Fato / Causa / Ação */}
        <div className="mb-4 space-y-3">
          <div>
            <label className="label">Fato — o que aconteceu na semana</label>
            <textarea className="input" rows={2} value={form.fato}
              onChange={(e) => setForm({ ...form, fato: e.target.value })}
              placeholder="Ex: cliente demorou pra aprovar campanha, resultado ficou 20% abaixo da meta" />
          </div>
          <div>
            <label className="label">Causa — por que aconteceu</label>
            <textarea className="input" rows={2} value={form.causa}
              onChange={(e) => setForm({ ...form, causa: e.target.value })}
              placeholder="Ex: falta de reunião estratégica, cliente sem clareza do objetivo" />
          </div>
          <div>
            <label className="label">Ação — o que vamos fazer</label>
            <textarea className="input" rows={2} value={form.acao}
              onChange={(e) => setForm({ ...form, acao: e.target.value })}
              placeholder="Ex: agendar semanal fixa, criar deck de recap" />
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Observações (opcional)</label>
          <input className="input" value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
        </div>

        {/* Monetização */}
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={temOportunidade} onChange={(e) => setTemOportunidade(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500" />
              <span className="text-sm font-semibold text-amber-300">Oportunidade de monetizacao identificada</span>
            </label>
          </div>
          {temOportunidade && (
            <div className="space-y-2 mt-2">
              <div>
                <label className="label text-xs">O que pode ser vendido / expandido?</label>
                <input className="input text-sm" value={opForm.titulo}
                  onChange={(e) => setOpForm({ ...opForm, titulo: e.target.value })}
                  placeholder="Ex: Expansao de trafego pago, LP extra, Social Media" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Valor MRR estimado (R$/mes)</label>
                  <input className="input text-sm" type="number" value={opForm.valor_mrr}
                    onChange={(e) => setOpForm({ ...opForm, valor_mrr: e.target.value })}
                    placeholder="0" />
                </div>
                <div>
                  <label className="label text-xs">Valor one-time estimado (R$)</label>
                  <input className="input text-sm" type="number" value={opForm.valor_onetime}
                    onChange={(e) => setOpForm({ ...opForm, valor_onetime: e.target.value })}
                    placeholder="0" />
                </div>
              </div>
              <div>
                <label className="label text-xs">Contexto / detalhes (opcional)</label>
                <textarea className="input text-sm" rows={2} value={opForm.descricao}
                  onChange={(e) => setOpForm({ ...opForm, descricao: e.target.value })}
                  placeholder="Ex: Cliente mencionou interesse em redes sociais durante reuniao" />
              </div>
              <p className="text-[10px] text-amber-300/60">Ao salvar o FCA, essa oportunidade sera criada automaticamente no pipeline de monetizacao (estagio: ideia).</p>
            </div>
          )}
        </div>

        {/* Botões */}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={saving} onClick={() => salvar("rascunho")}>
            {saving ? "..." : "Salvar rascunho"}
          </button>
          <button className="btn-ghost" disabled={saving} onClick={() => salvar("aguardando_validacao")}>
            Enviar para validação
          </button>
          {podeValidar && (
            <button className="btn-ghost bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              disabled={saving} onClick={() => salvar("validado")}>
              ✓ Validar (coordenador)
            </button>
          )}
          {!podeValidar && (
            <span className="text-[10px] text-brand-muted italic">
              validação disponível apenas para Coordenador/Gerente
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {avaliacao && (
              <button className="text-xs text-red-300 hover:text-red-400" onClick={remover}>
                Excluir
              </button>
            )}
            <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
