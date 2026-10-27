"use client";

import type { AnaliseExtra, AvaliacaoEE } from "@/lib/analiseIA";

// Blocos da análise de IA que Reuniões e Radar WhatsApp mostram igual.

const corNivel = (bom: boolean, ruim: boolean) =>
  ruim ? "bg-red-500/15 text-red-300" : bom ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300";

function Selo({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] ${cor}`}>
      <span className="opacity-70">{label}:</span> <b>{valor}</b>
    </span>
  );
}

/** Selos curtos para listas (temperatura, estresse, reclamação, compra, resultado). */
export function SelosAnalise({ a, temperatura, risco }: { a: Partial<AnaliseExtra>; temperatura?: string | null; risco?: string | null }) {
  const compra = a.intencao_compra?.nivel ?? "nenhuma";
  const resultado = a.resultado_percebido?.avaliacao ?? "nao_mencionado";
  return (
    <div className="flex flex-wrap gap-1">
      {temperatura && (
        <Selo label="Temperatura" valor={temperatura} cor={corNivel(temperatura === "quente", temperatura === "fria")} />
      )}
      {risco && <Selo label="Churn" valor={risco} cor={corNivel(risco === "baixo", risco === "alto")} />}
      {a.estresse && <Selo label="Estresse" valor={a.estresse} cor={corNivel(a.estresse === "nenhum", a.estresse === "alto")} />}
      {a.reclamacao && (
        <Selo label="Reclamou" valor={a.reclamacao.houve ? "sim" : "não"} cor={corNivel(!a.reclamacao.houve, a.reclamacao.houve)} />
      )}
      {compra !== "nenhuma" && <Selo label="Quer comprar" valor={compra} cor="bg-emerald-500/15 text-emerald-300" />}
      {resultado !== "nao_mencionado" && (
        <Selo label="Resultado" valor={resultado} cor={corNivel(resultado === "satisfeito", resultado === "insatisfeito")} />
      )}
      {a.concorrencia?.mencionou && <Selo label="Concorrência" valor="citou" cor="bg-red-500/15 text-red-300" />}
      {a.estruturacao && (
        <Selo label={`E.E${a.estruturacao.semana ? ` · Semana ${a.estruturacao.semana}` : ""}`}
          valor={`entrega ${a.estruturacao.nota_entrega}/5`}
          cor={corNivel(a.estruturacao.nota_entrega >= 4, a.estruturacao.nota_entrega <= 2)} />
      )}
    </div>
  );
}

const ORDEM_PRIORIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const COR_PRIORIDADE: Record<string, string> = {
  alta: "bg-red-500/20 text-red-300",
  media: "bg-amber-500/20 text-amber-300",
  baixa: "bg-white/10 text-brand-muted",
};

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{titulo}</p>
      <div className="text-xs">{children}</div>
    </div>
  );
}

function Lista({ itens }: { itens?: string[] }) {
  if (!itens?.length) return null;
  return <ul className="list-disc pl-4 space-y-0.5">{itens.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

const STATUS_EE: Record<string, { icone: string; cor: string }> = {
  entregue: { icone: "✓", cor: "text-emerald-300" },
  parcial: { icone: "◐", cor: "text-amber-300" },
  nao_entregue: { icone: "✗", cor: "text-red-300" },
};

/** Avaliação da entrega do time numa semana da Estruturação Estratégica. */
function BlocoEE({ e }: { e: AvaliacaoEE }) {
  return (
    <Bloco titulo={`🧭 Estruturação Estratégica${e.semana ? ` · Semana ${e.semana}` : ""}${e.etapa ? ` – ${e.etapa}` : ""} · entrega ${e.nota_entrega}/5`}>
      <div className="rounded border border-white/5 bg-black/20 p-1.5 space-y-1">
        <ul className="space-y-0.5">
          {(e.entregas ?? []).map((x, i) => (
            <li key={i}>
              <span className={STATUS_EE[x.status]?.cor}>{STATUS_EE[x.status]?.icone ?? "•"}</span> <b>{x.item}</b>
              {x.comentario && <span className="text-brand-muted"> — {x.comentario}</span>}
            </li>
          ))}
        </ul>
        <p className={e.cliente_validou ? "text-emerald-300" : "text-amber-300"}>
          {e.cliente_validou ? "✓ Cliente validou a entrega" : "⚠ Cliente não validou de forma clara"}
        </p>
        {!!e.pontos_fortes?.length && <div><p className="text-brand-muted">Pontos fortes</p><Lista itens={e.pontos_fortes} /></div>}
        {!!e.lacunas?.length && <div><p className="text-brand-muted">Lacunas</p><Lista itens={e.lacunas} /></div>}
        {!!e.pendencias_proxima_semana?.length && (
          <div><p className="text-brand-muted">Pendências para a próxima semana</p><Lista itens={e.pendencias_proxima_semana} /></div>
        )}
      </div>
    </Bloco>
  );
}

/** Análise completa (detalhes). */
export function DetalhesAnalise({ a }: { a: Partial<AnaliseExtra> }) {
  const c = a.conducao;
  return (
    <div>
      {a.estruturacao && <BlocoEE e={a.estruturacao} />}
      {!!a.plano_acao?.length && (
        <Bloco titulo="🛠️ Plano de ação sugerido">
          <ul className="space-y-1.5">
            {[...a.plano_acao]
              .sort((x, y) => ORDEM_PRIORIDADE[x.prioridade] - ORDEM_PRIORIDADE[y.prioridade])
              .map((p, i) => (
                <li key={i} className="rounded border border-white/5 bg-black/20 p-1.5">
                  <span className={`mr-1 rounded px-1.5 text-[9px] font-bold uppercase ${COR_PRIORIDADE[p.prioridade] ?? ""}`}>{p.prioridade}</span>
                  <b>{p.ponto}</b>
                  <p className="mt-0.5">→ {p.sugestao}</p>
                  {(p.responsavel || p.prazo) && (
                    <p className="text-[10px] text-brand-muted">
                      {p.responsavel}{p.responsavel && p.prazo ? " · " : ""}{p.prazo}
                    </p>
                  )}
                </li>
              ))}
          </ul>
        </Bloco>
      )}
      {!!a.insights?.length && (
        <Bloco titulo="💡 Insights"><Lista itens={a.insights} /></Bloco>
      )}
      {a.estresse && a.estresse !== "nenhum" && a.estresse_detalhe && (
        <Bloco titulo="Estresse do cliente">{a.estresse_detalhe}</Bloco>
      )}
      {a.reclamacao?.houve && (
        <Bloco titulo="Reclamações"><Lista itens={a.reclamacao.motivos} /></Bloco>
      )}
      {a.intencao_compra && a.intencao_compra.nivel !== "nenhuma" && (
        <Bloco titulo="Intenção de compra">
          {a.intencao_compra.produtos?.length ? <b>{a.intencao_compra.produtos.join(", ")}</b> : null}
          {a.intencao_compra.evidencia && <p className="text-brand-muted">“{a.intencao_compra.evidencia}”</p>}
        </Bloco>
      )}
      {a.resultado_percebido && a.resultado_percebido.avaliacao !== "nao_mencionado" && (
        <Bloco titulo="Resultado percebido">{a.resultado_percebido.detalhe}</Bloco>
      )}
      {!!a.mudancas_negocio?.length && (
        <Bloco titulo="Mudanças no negócio do cliente">
          <ul className="list-disc pl-4">
            {a.mudancas_negocio.map((m, i) => <li key={i}><b>{m.tipo}:</b> {m.descricao}</li>)}
          </ul>
        </Bloco>
      )}
      {a.concorrencia?.mencionou && (
        <Bloco titulo="Concorrência">{a.concorrencia.detalhe}</Bloco>
      )}
      {!!a.compromissos?.length && (
        <Bloco titulo="Compromissos">
          <ul className="space-y-0.5">
            {a.compromissos.map((m, i) => (
              <li key={i}>
                <span className={m.lado === "ruston" ? "text-brand" : "text-sky-300"}>{m.lado === "ruston" ? "Ruston" : "Cliente"}</span>
                {" · "}{m.o_que}
                {m.responsavel && <span className="text-brand-muted"> — {m.responsavel}</span>}
                {m.prazo && <span className="text-amber-300"> · até {m.prazo}</span>}
              </li>
            ))}
          </ul>
        </Bloco>
      )}
      {c && c.nota > 0 && (
        <Bloco titulo={`Condução do time · nota ${c.nota}/5`}>
          <p className="text-brand-muted">
            {c.teve_pauta ? "✓" : "✗"} pauta · {c.apresentou_dados ? "✓" : "✗"} dados · {c.fechou_proximos_passos ? "✓" : "✗"} próximos passos
          </p>
          {c.comentario && <p>{c.comentario}</p>}
        </Bloco>
      )}
    </div>
  );
}
