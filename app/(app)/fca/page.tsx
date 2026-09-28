"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sextaDaSemanaFca, formatSemanaFca } from "@/lib/types";

// ============================================================
// COMPONENTE — Importação de FCA via JSON  (v2 — com tratamento de erro)
// ============================================================

type FcaJsonInput = {
  cliente?: string;
  cliente_id?: string;
  data_referencia?: string;
  notas: {
    resultado: number;
    operacao_trafego: number;
    prazo: number;
    qualidade: number;
    relacionamento: number;
    roi: number;
  };
  fato?: string;
  causa?: string;
  acao?: string;
  observacoes?: string;
};

type PreviewItem = {
  input: FcaJsonInput;
  cliente_id: string | null;
  cliente_nome: string | null;
  candidatos?: { id: string; nome: string }[]; // se houve múltiplos matches
  data_ref: string;
  jaExiste: boolean;
  fcaExistenteId?: string;
  acao: "criar" | "sobrescrever" | "pular";
  erro?: string;
};

const TEMPLATE_JSON = {
  cliente: "Rubinot",
  data_referencia: "2026-08-14",
  notas: {
    resultado: 8, operacao_trafego: 7, prazo: 9,
    qualidade: 8, relacionamento: 9, roi: 7,
  },
  fato: "Cliente atingiu 85% da meta de MQLs. Campanhas rodando estáveis.",
  causa: "Google Ads teve boa performance com CTR acima de 5% nas keywords principais.",
  acao: "Aumentar verba em 20% na próxima semana e testar 3 novas headlines.",
  observacoes: "Cliente pediu alteração no criativo do carrossel.",
};

const PROMPT_IA = `Você é um analista de contas de uma agência de marketing digital.
Vou te enviar a transcrição de uma reunião de check-in semanal com o cliente.
Gere um JSON no formato abaixo com a avaliação FCA (Fato, Causa, Ação) da semana.

CRITÉRIOS (nota de 0 a 10):
- resultado (peso 7): atingiu metas de MQL / faturamento?
- operacao_trafego (peso 5): campanhas rodando, verba controlada, criativos acompanhados?
- prazo (peso 5): entregas estão em dia?
- qualidade (peso 4): qualidade das entregas está boa?
- relacionamento (peso 4): comunicação com o cliente está fluida?
- roi (peso 8): cliente está tendo retorno positivo do investimento?

REGRAS:
- Se algum critério não puder ser avaliado, use 5 (neutro) e explique em observacoes
- Fato deve ser objetivo (o QUE aconteceu)
- Causa deve explicar (POR QUE aconteceu)
- Ação deve ser prescritiva (O QUE vai ser feito)
- data_referencia deve ser a próxima sexta-feira no formato YYYY-MM-DD

TRANSCRIÇÃO:
[COLE AQUI A TRANSCRIÇÃO DA REUNIÃO]

FORMATO DE SAÍDA — retorne APENAS o JSON, sem texto antes/depois:
{
  "cliente": "NOME DO CLIENTE",
  "data_referencia": "2026-08-14",
  "notas": { "resultado": 8, "operacao_trafego": 7, "prazo": 9, "qualidade": 8, "relacionamento": 9, "roi": 7 },
  "fato": "...", "causa": "...", "acao": "...", "observacoes": "..."
}`;

export default function FcaImportJson({ onDone }: { onDone?: () => void }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [resultado, setResultado] = useState<{ sucessos: number; erros: string[] } | null>(null);

  function reset() {
    setRawJson(""); setPreview(null); setImporting(false); setResultado(null);
  }
  function fechar() { setOpen(false); reset(); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRawJson(await file.text());
  }

  async function validarEGerarPreview() {
    if (!rawJson.trim()) { alert("Cole ou faça upload do JSON primeiro"); return; }
    let parsed: any;
    try { parsed = JSON.parse(rawJson); }
    catch (err) { alert("JSON inválido: " + (err as Error).message); return; }

    const arr: FcaJsonInput[] = Array.isArray(parsed) ? parsed : [parsed];
    const items: PreviewItem[] = [];

    for (const input of arr) {
      const dataRef = input.data_referencia || sextaDaSemanaFca();
      let clienteId: string | null = null;
      let clienteNome: string | null = null;
      let candidatos: { id: string; nome: string }[] = [];
      let erro: string | undefined;

      // 1) Tenta por ID
      if (input.cliente_id) {
        const { data: c } = await supabase
          .from("ruston_clientes").select("id, nome")
          .eq("id", input.cliente_id).maybeSingle();
        if (c) { clienteId = c.id; clienteNome = c.nome; }
        else erro = "cliente_id não encontrado";
      }

      // 2) Tenta por nome com match EXATO primeiro, depois ILIKE
      if (!clienteId && input.cliente) {
        // Match exato (case insensitive)
        const { data: exato } = await supabase
          .from("ruston_clientes").select("id, nome")
          .ilike("nome", input.cliente).eq("ativo", true);
        if (exato && exato.length === 1) {
          clienteId = exato[0].id; clienteNome = exato[0].nome;
        } else {
          // Match parcial — pega TODOS os candidatos
          const { data: parciais } = await supabase
            .from("ruston_clientes").select("id, nome")
            .ilike("nome", `%${input.cliente}%`).eq("ativo", true);
          if (parciais && parciais.length === 1) {
            clienteId = parciais[0].id; clienteNome = parciais[0].nome;
          } else if (parciais && parciais.length > 1) {
            candidatos = parciais;
            erro = `Cliente "${input.cliente}" tem ${parciais.length} matches ambíguos — escolha manual necessária`;
          } else {
            erro = `Cliente "${input.cliente}" não encontrado`;
          }
        }
      }
      if (!clienteId && !input.cliente_id && !input.cliente) {
        erro = "JSON sem cliente (nem cliente nem cliente_id)";
      }

      // Valida notas
      if (!input.notas) erro = erro ?? "JSON sem campo 'notas'";
      else {
        const chaves = ["resultado", "operacao_trafego", "prazo", "qualidade", "relacionamento", "roi"];
        for (const k of chaves) {
          const v = (input.notas as any)[k];
          if (v == null || typeof v !== "number" || v < 0 || v > 10) {
            erro = erro ?? `Nota '${k}' inválida (deve ser número de 0 a 10)`;
            break;
          }
        }
      }

      let jaExiste = false;
      let fcaExistenteId: string | undefined;
      if (clienteId && !erro) {
        const { data: existente } = await supabase
          .from("ruston_fca").select("id")
          .eq("cliente_id", clienteId).eq("data_referencia", dataRef).maybeSingle();
        if (existente) { jaExiste = true; fcaExistenteId = existente.id; }
      }

      items.push({
        input, cliente_id: clienteId, cliente_nome: clienteNome, candidatos: candidatos.length > 1 ? candidatos : undefined,
        data_ref: dataRef, jaExiste, fcaExistenteId,
        acao: erro ? "pular" : jaExiste ? "sobrescrever" : "criar",
        erro,
      });
    }
    setPreview(items);
  }

  async function confirmar() {
    if (!preview) return;
    setImporting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: perfilRow } = await supabase
      .from("ruston_usuario_perfil").select("pessoa_id")
      .eq("email", user?.email ?? "").maybeSingle();
    const pessoaId = (perfilRow as any)?.pessoa_id ?? null;

    let sucessos = 0;
    const erros: string[] = [];

    if (!user) {
      erros.push("Você não está logado. Faça login e tente de novo.");
      setImporting(false);
      setResultado({ sucessos, erros });
      return;
    }

    for (const item of preview) {
      if (item.acao === "pular" || !item.cliente_id) continue;
      const nome = item.cliente_nome ?? item.input.cliente ?? "?";
      const d = new Date(item.data_ref + "T00:00:00");
      const payload: any = {
        cliente_id: item.cliente_id,
        ano: d.getFullYear(),
        mes: d.getMonth() + 1,
        data_referencia: item.data_ref,
        nota_resultado: item.input.notas.resultado,
        nota_operacao_trafego: item.input.notas.operacao_trafego,
        nota_prazo: item.input.notas.prazo,
        nota_qualidade: item.input.notas.qualidade,
        nota_relacionamento: item.input.notas.relacionamento,
        nota_roi: item.input.notas.roi,
        fato: item.input.fato ?? null,
        causa: item.input.causa ?? null,
        acao: item.input.acao ?? null,
        observacoes: item.input.observacoes ?? null,
        status: "rascunho",
      };
      // Só inclui preenchido_por_id se conseguimos resolver
      if (pessoaId) payload.preenchido_por_id = pessoaId;

      try {
        if (item.acao === "sobrescrever" && item.fcaExistenteId) {
          const { error, data } = await supabase.from("ruston_fca")
            .update(payload).eq("id", item.fcaExistenteId).select();
          if (error) throw error;
          if (!data || data.length === 0) throw new Error("update retornou 0 linhas (RLS bloqueou?)");
          sucessos++;
        } else if (item.acao === "criar") {
          const { error, data } = await supabase.from("ruston_fca")
            .insert(payload).select();
          if (error) throw error;
          if (!data || data.length === 0) throw new Error("insert retornou 0 linhas (RLS bloqueou?)");
          sucessos++;
        }
      } catch (err: any) {
        erros.push(`${nome} · ${item.data_ref}: ${err?.message ?? String(err)}`);
      }
    }

    setImporting(false);
    setResultado({ sucessos, erros });
    if (erros.length === 0) {
      onDone?.();
    } else {
      // Se pelo menos 1 gravou, atualiza a lista mas mantém o modal aberto pra mostrar erros
      if (sucessos > 0) onDone?.();
    }
  }

  if (!open) {
    return (
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)} title="Importar FCAs via JSON">
        📁 Importar JSON
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={fechar}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg border border-white/10 bg-brand-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Importar FCAs via JSON</h3>
            <p className="text-xs text-brand-muted">Cola um JSON gerado por IA ou upload de .json</p>
          </div>
          <button onClick={fechar} className="text-brand-muted hover:text-white">✕</button>
        </div>

        {/* TELA DE RESULTADO — depois do import */}
        {resultado && (
          <>
            <div className={`mb-4 rounded-lg border p-4 ${
              resultado.erros.length === 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"
            }`}>
              <p className="text-sm font-bold">
                {resultado.erros.length === 0 ? "✅ Importação concluída com sucesso" : "⚠ Importação parcial"}
              </p>
              <p className="mt-1 text-xs">
                <span className="text-emerald-300">{resultado.sucessos} gravado(s)</span>
                {resultado.erros.length > 0 && (
                  <> · <span className="text-red-300">{resultado.erros.length} falha(s)</span></>
                )}
              </p>
            </div>
            {resultado.erros.length > 0 && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <p className="mb-2 text-xs font-semibold text-red-300">Erros detalhados:</p>
                <ul className="space-y-1 text-xs">
                  {resultado.erros.map((e, i) => (
                    <li key={i} className="text-red-200">• {e}</li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] text-brand-muted italic">
                  Se aparecer "RLS bloqueou" — seu email de login precisa estar cadastrado em <code>ruston_usuario_perfil</code> com um <code>pessoa_id</code> válido.
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <button className="btn" onClick={fechar}>Fechar</button>
            </div>
          </>
        )}

        {/* TELA DE ENTRADA */}
        {!resultado && !preview && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <label className="btn-ghost cursor-pointer text-xs">
                📄 Upload .json
                <input type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
              </label>
              <button className="btn-ghost text-xs" onClick={() => setShowTemplate(!showTemplate)}>
                {showTemplate ? "▲ Ocultar template" : "▼ Ver template"}
              </button>
              <button className="btn-ghost text-xs" onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? "▲ Ocultar prompt" : "▼ Ver prompt IA"}
              </button>
            </div>
            {showTemplate && (
              <div className="mb-3 rounded-lg border border-white/10 bg-black/30 p-3">
                <pre className="overflow-x-auto rounded bg-black/50 p-3 text-xs text-emerald-300">{JSON.stringify(TEMPLATE_JSON, null, 2)}</pre>
                <button className="btn-ghost mt-2 text-xs" onClick={() => { navigator.clipboard.writeText(JSON.stringify(TEMPLATE_JSON, null, 2)); alert("Copiado!"); }}>📋 Copiar</button>
              </div>
            )}
            {showPrompt && (
              <div className="mb-3 rounded-lg border border-white/10 bg-black/30 p-3">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-black/50 p-3 text-xs text-sky-300">{PROMPT_IA}</pre>
                <button className="btn-ghost mt-2 text-xs" onClick={() => { navigator.clipboard.writeText(PROMPT_IA); alert("Copiado!"); }}>📋 Copiar</button>
              </div>
            )}
            <div>
              <label className="label">Cole o JSON aqui</label>
              <textarea className="input min-h-[240px] font-mono text-xs" value={rawJson} onChange={(e) => setRawJson(e.target.value)} placeholder='{"cliente": "...", "notas": {...}}' />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={fechar}>Cancelar</button>
              <button className="btn" onClick={validarEGerarPreview}>Validar & Preview</button>
            </div>
          </>
        )}

        {/* TELA DE PREVIEW */}
        {!resultado && preview && (
          <>
            <div className="mb-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
              <p>
                <strong className="text-white">{preview.length}</strong> FCA(s) ·{" "}
                <span className="text-emerald-300">{preview.filter((p) => p.acao === "criar").length} criar</span> ·{" "}
                <span className="text-amber-300">{preview.filter((p) => p.acao === "sobrescrever").length} sobrescrever</span> ·{" "}
                <span className="text-red-300">{preview.filter((p) => p.acao === "pular").length} pular</span>
              </p>
            </div>
            <div className="space-y-3">
              {preview.map((item, i) => (
                <div key={i} className={`rounded-lg border p-3 ${
                  item.erro ? "border-red-500/30 bg-red-500/5" : item.jaExiste ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"
                }`}>
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold">{item.cliente_nome ?? (item.input.cliente || item.input.cliente_id || "—")}</p>
                      <p className="text-xs text-brand-muted">{formatSemanaFca(item.data_ref)} · {item.data_ref}</p>
                    </div>
                    <select className="input py-1 text-xs" value={item.acao}
                      onChange={(e) => { const u = [...preview]; u[i] = { ...item, acao: e.target.value as any }; setPreview(u); }}
                      disabled={!!item.erro && !item.candidatos}>
                      {!item.erro && !item.jaExiste && <option value="criar">Criar novo</option>}
                      {!item.erro && item.jaExiste && <option value="sobrescrever">Sobrescrever existente</option>}
                      <option value="pular">Pular</option>
                    </select>
                  </div>
                  {item.erro && <p className="text-xs text-red-300">⚠ {item.erro}</p>}
                  {item.candidatos && item.candidatos.length > 1 && (
                    <div className="mt-2 rounded bg-black/30 p-2">
                      <p className="mb-1 text-[10px] text-brand-muted">Escolhe o cliente correto:</p>
                      <select className="input py-1 text-xs" value={item.cliente_id ?? ""}
                        onChange={async (e) => {
                          const chosenId = e.target.value;
                          const chosen = item.candidatos!.find((c) => c.id === chosenId);
                          if (!chosen) return;
                          const { data: existente } = await supabase.from("ruston_fca").select("id")
                            .eq("cliente_id", chosen.id).eq("data_referencia", item.data_ref).maybeSingle();
                          const u = [...preview];
                          u[i] = { ...item, cliente_id: chosen.id, cliente_nome: chosen.nome, erro: undefined,
                            jaExiste: !!existente, fcaExistenteId: existente?.id,
                            acao: existente ? "sobrescrever" : "criar" };
                          setPreview(u);
                        }}>
                        <option value="">— selecionar —</option>
                        {item.candidatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </div>
                  )}
                  {!item.erro && (
                    <div className="grid grid-cols-6 gap-1 text-center text-xs">
                      {Object.entries(item.input.notas).map(([k, v]) => (
                        <div key={k} className="rounded bg-white/5 p-1">
                          <p className="text-[10px] text-brand-muted">{k.substring(0, 6)}</p>
                          <p className="font-bold">{v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setPreview(null)}>← Voltar</button>
              <button className="btn" onClick={confirmar} disabled={importing}>
                {importing ? "Importando..." : "Confirmar importação"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
