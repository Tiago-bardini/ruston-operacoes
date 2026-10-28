/* ============================== PLAYBOOK NPS: rituais de NPS e Sucesso do Cliente ============================== */

// Documento completo (roteiros, modelos de dossiê, checklist), compartilhado pelo Share do claude.ai
const DOC_URL = "https://claude.ai/artifact/DAqenaJ2PLk5ccH5QZ7HpH";

const RITUAIS = [
  { nome: "1. Régua de coleta do NPS", dono: "Gestor (passos 1–3) · Coordenador (passo 4)", cadencia: "1ª e 2ª semana do mês, até o dia 10" },
  { nome: "2. Micro-pesquisa por marco", dono: "Gestor da conta", cadencia: "Até 24h após kickoff, planejamento e entrega estratégica" },
  { nome: "3. Health Check de sexta", dono: "Coordenador", cadencia: "Toda sexta, 30 min" },
  { nome: "4. Dossiê + plano de ação", dono: "Coordenador", cadencia: "Conta amarela/vermelha: dossiê em 2 dias, plano em 5 dias úteis" },
  { nome: "5. Mesa Vermelha", dono: "Gerente da unidade", cadencia: "Mensal, 60 min" },
];

const REGUA = [
  { passo: "QR code ao vivo", quando: "Check-in da 1ª semana", canal: "Na reunião", quem: "Gestor" },
  { passo: "Lembrete no grupo", quando: "+2 dias úteis", canal: "Grupo geral do cliente", quem: "Gestor" },
  { passo: "Mensagem privada", quando: "+2 dias úteis", canal: "Chat com o stakeholder", quem: "Gestor" },
  { passo: "Ligação", quando: "Até o dia 10", canal: "Telefone", quem: "Coordenador" },
];

const CRITERIOS = [
  { c: "Resultado vs meta do cliente", verde: "No ritmo ou acima", amarelo: "Até 20% abaixo", vermelho: "> 20% abaixo ou 2 meses seguidos" },
  { c: "Prazos de entrega", verde: "Em dia", amarelo: "1 entrega atrasada", vermelho: "2+ atrasadas ou marco crítico" },
  { c: "Stakeholder", verde: "Responde em 48h, vai às reuniões", amarelo: "Demora ou faltou a 1 reunião", vermelho: "Sumiu, cancelou ou trocou de interlocutor" },
  { c: "NPS / micro-pesquisa", verde: "NPS 9–10 · micro 4–5", amarelo: "NPS 7–8 · micro 3", vermelho: "NPS 0–6 · micro 1–2" },
  { c: "Reclamação / sinal de saída", verde: "Nenhum", amarelo: "Pontual, resolvida", vermelho: "Aberta, redução ou fala de cancelamento" },
  { c: "Financeiro", verde: "Em dia", amarelo: "1 atraso", vermelho: "Inadimplência ou renegociação" },
];

const PAUTAS = [
  {
    titulo: "Health Check de sexta · 30 min",
    itens: [
      "5 min: o que mudou de cor desde a última sexta",
      "15 min: vermelhas e amarelas: causa, dono e próximo passo",
      "5 min: verdes com oportunidade de expansão",
      "5 min: atualizar o painel e definir quem abre dossiê",
    ],
  },
  {
    titulo: "Mesa Vermelha · 60 min",
    itens: [
      "5 min: números do mês por cor, cancelamentos e recuperações",
      "35 min: casos vermelhos (até 7 min cada) com decisão, dono e prazo",
      "10 min: aprendizados das contas que voltaram a verde",
      "10 min: expectativas que podem virar projeto novo",
    ],
  },
];

const REGRAS = [
  "Pior critério define a cor: um vermelho deixa a conta vermelha.",
  "Detrator (0–6): ligação do coordenador em até 48h e dossiê aberto.",
  "Conta virou vermelha no meio do mês: avisar o gerente em 24h e alinhar em 48h, sem esperar a Mesa Vermelha.",
  "A ligação do passo 4 coleta a resposta, nunca pede nota.",
];

export default function PlaybookNpsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">📘 Playbook NPS</h1>
          <p className="text-sm text-brand-muted">
            Os 5 rituais de NPS e Sucesso do Cliente da unidade. Roteiros, modelo de dossiê e checklist estão no documento completo.
          </p>
        </div>
        <a href={DOC_URL} target="_blank" rel="noopener noreferrer" className="btn">
          Abrir playbook completo ↗
        </a>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold">Os 5 rituais</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-brand-muted">
            <tr><th className="pb-2">Ritual</th><th className="pb-2">Dono</th><th className="pb-2">Cadência</th></tr>
          </thead>
          <tbody>
            {RITUAIS.map((r) => (
              <tr key={r.nome} className="border-t border-white/5">
                <td className="py-2 font-medium">{r.nome}</td>
                <td className="py-2 text-gray-300">{r.dono}</td>
                <td className="py-2 text-gray-300">{r.cadencia}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold">Régua de coleta do NPS · meta: 100% de respostas até o dia 10</h2>
        <div className="grid gap-3 md:grid-cols-4">
          {REGUA.map((p, i) => (
            <div key={p.passo} className="rounded-lg border border-white/5 bg-black/20 p-3">
              <p className="text-xs text-brand-muted">Passo {i + 1} · {p.quando}</p>
              <p className="font-medium">{p.passo}</p>
              <p className="text-xs text-gray-300">{p.canal} · {p.quem}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold">Critérios do Health Check</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase">
            <tr>
              <th className="pb-2 text-brand-muted">Critério</th>
              <th className="pb-2 text-emerald-400">Verde</th>
              <th className="pb-2 text-amber-400">Amarelo</th>
              <th className="pb-2 text-red-400">Vermelho</th>
            </tr>
          </thead>
          <tbody>
            {CRITERIOS.map((c) => (
              <tr key={c.c} className="border-t border-white/5 align-top">
                <td className="py-2 font-medium">{c.c}</td>
                <td className="py-2 text-gray-300">{c.verde}</td>
                <td className="py-2 text-gray-300">{c.amarelo}</td>
                <td className="py-2 text-gray-300">{c.vermelho}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {PAUTAS.map((p) => (
          <div key={p.titulo} className="card">
            <h2 className="mb-3 text-sm font-semibold">{p.titulo}</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-300">
              {p.itens.map((it) => <li key={it}>{it}</li>)}
            </ol>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold">Regras que não mudam</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
          {REGRAS.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
    </div>
  );
}
