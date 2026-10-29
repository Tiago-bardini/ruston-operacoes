"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SubAbas from "@/components/SubAbas";

/* ============================== PLAYBOOK NPS: método "NPS com volume e qualidade" ============================== */
// Base: Playbook NPS da V4 Barcellos & Co. (out/2026), adaptado para a Ruston.

type Aba = "geral" | "cadencia" | "pulso" | "cs" | "meta" | "implantar";

const ABAS: { v: Aba; label: string }[] = [
  { v: "geral", label: "Visão geral" },
  { v: "cadencia", label: "1 · Cadência do NPS" },
  { v: "pulso", label: "2 · Pulso firme" },
  { v: "cs", label: "3 · CS preventivo" },
  { v: "meta", label: "Meta é rei" },
  { v: "implantar", label: "✓ Implantação" },
];

/* ------------------------------ Pilar 1 ------------------------------ */

const CADENCIA = [
  { etapa: "Check-in", quando: "1ª semana do mês, no fim da reunião", quem: "Time do squad", canal: "QR Code na tela", como: "Explica a importância, pede a avaliação e segura a reunião alguns minutos para o cliente responder ali mesmo." },
  { etapa: "Grupo do cliente", quando: "Logo após o check-in, se não respondeu", quem: "Time do squad", canal: "Grupo de WhatsApp", como: "Reforço leve, com o link e o contexto da pesquisa." },
  { etapa: "Privado do stakeholder", quando: "Na sequência, se seguir sem resposta", quem: "Time do squad", canal: "Mensagem direta", como: "Abordagem pessoal, um a um." },
  { etapa: "Coordenação", quando: "Pesquisa de quarter, ou cliente que não respondeu a anterior", quem: "Coordenador responsável", canal: "Mensagem e ligação", como: "O coordenador entra pessoalmente e reforça o pedido." },
];

const ROTEIROS = [
  { titulo: "1 · Fala no check-in", texto: "Antes de fecharmos, tem um QR Code na tela com a pesquisa da rede V4. Leva menos de 1 minuto e é o que usamos para ajustar o trabalho com vocês. Consegue responder agora, enquanto estamos aqui? Eu espero." },
  { titulo: "2 · Mensagem no grupo", texto: "Pessoal, obrigado pelo check-in de hoje! Quem ainda não respondeu a pesquisa da rede, segue o link: [link]. Leva menos de 1 minuto e a opinião de vocês define nossas prioridades das próximas semanas." },
  { titulo: "3 · Privado do stakeholder", texto: "Oi, [nome]! Sei que a rotina está corrida. Sua resposta na pesquisa da rede é a que mais pesa para nós, porque você acompanha o projeto de perto. Segue o link: [link]. Obrigado!" },
  { titulo: "4 · Coordenador (mensagem + ligação)", texto: "Oi, [nome], aqui é [coordenador], coordenador do time que atende vocês. Estou entrando em contato porque sua avaliação é muito importante para mim. Quero ouvir sua opinião sincera, seja ela qual for. Consegue responder pelo link [link]? Se preferir, me conta por aqui mesmo." },
];

/* ------------------------------ Pilar 2 ------------------------------ */

const PESQUISAS = [
  { momento: "Fim do planejamento", pesquisa: "CSAT pós-planejamento", mede: "Satisfação com a estratégia apresentada e se podemos seguir para aprovação e execução" },
  { momento: "Cada check-in", pesquisa: "Avaliação do check-in", mede: "Clareza dos resultados, alinhamento com expectativas, temas mais valiosos, próximos passos e satisfação" },
  { momento: "Entregas da estruturação estratégica", pesquisa: "Satisfação EE", mede: "Profundidade do diagnóstico e clareza sobre os pontos cegos do negócio" },
  { momento: "Pesquisa da rede", pesquisa: "NPS Rede", mede: "NPS, MHS e CSAT (cadência do Pilar 1)" },
];

type Pergunta = { p: string; formato: string; respostas?: string[] };
type Formulario = { id: string; nome: string; titulo: string; abertura?: string; perguntas: Pergunta[] };

const FORMULARIOS: Formulario[] = [
  {
    id: "planejamento",
    nome: "Pós-planejamento",
    titulo: "Pesquisa CSAT | Pós Planejamento | Ruston & Co",
    abertura: "Esta pesquisa rápida leva menos de 2 minutos. Queremos entender o quanto a estratégia entregue (Tráfego, Criativos, LPs e ações) atendeu às suas expectativas para garantirmos total alinhamento antes de ir para a execução.",
    perguntas: [
      { p: "E-mail", formato: "Coletado pelo formulário, obrigatória" },
      { p: "Nome da Empresa", formato: "Resposta curta, obrigatória" },
      { p: "De 0 a 5, o quanto você ficou satisfeito com a estratégia apresentada para o seu negócio?", formato: "Escala linear 0 a 5, obrigatória", respostas: ["0 (Nada satisfeito)", "5 (Muito satisfeito)"] },
      { p: "O plano apresentado (Tráfego, Criativos, LPs e Ações) atendeu às suas expectativas de crescimento?", formato: "Escala linear 0 a 5, obrigatória", respostas: ["0 (Nada satisfeito)", "5 (Muito satisfeito)"] },
      { p: "O seu projeto contempla Social Media?", formato: "Caixas de seleção, obrigatória", respostas: ["Sim", "Não"] },
      { p: "Se sim: a estratégia proposta para as redes sociais está alinhada ao que você esperava?", formato: "Parágrafo, opcional" },
      { p: "Falta algo na estratégia entregue ou podemos seguir para a aprovação e execução?", formato: "Parágrafo, opcional" },
    ],
  },
  {
    id: "checkin",
    nome: "Pós-check-in",
    titulo: "Avaliação do Check-in Semanal | Ruston & Co",
    perguntas: [
      { p: "Clareza das informações e resultados: as informações, métricas de resultado e investimentos apresentados ficaram claros para você?", formato: "Múltipla escolha (escolha única)", respostas: ["Sim, tudo ficou extremamente claro e transparente.", "Em grande parte, mas ainda tenho algumas dúvidas.", "Não, achei a apresentação confusa ou complexa."] },
      { p: "Alinhamento com expectativas: o panorama apresentado hoje atendeu às suas expectativas para esta semana?", formato: "Escala linear 1 a 5", respostas: ["1: Totalmente desalinhado", "2: Ficou abaixo do esperado", "3: Atendeu parcialmente", "4: Atendeu completamente", "5: Superou as expectativas"] },
      { p: "Relevância dos conteúdos: quais dos temas abordados foram mais valiosos para você na reunião de hoje?", formato: "Caixas de seleção (várias)", respostas: ["Balanço financeiro e investimentos do período", "Resultados das métricas principais (KPIs)", "Análise dos criativos/ações vencedores", "Próximos passos e plano de ação futuro", "Oportunidades e gargalos identificados"] },
      { p: "Próximos passos: ficou claro para você o que o time fará ao longo desta próxima semana?", formato: "Múltipla escolha (escolha única)", respostas: ["Sim, sei exatamente o que está sendo executado e o que esperar.", "Tenho uma ideia geral, mas gostaria de mais detalhes no acompanhamento.", "Não, não entendi os próximos passos."] },
      { p: "Satisfação geral: de forma geral, como você avalia o check-in de hoje?", formato: "Múltipla escolha (escolha única)", respostas: ["Excelente (Produtiva e direto ao ponto)", "Boa (Atendeu ao objetivo)", "Neutra (Poderia ser melhor)", "Ruim (Desgastante / Pouco proveitosa)"] },
      { p: "Elogio, crítica ou sugestão: quer deixar algum elogio, crítica ou sugestão para o nosso próximo check-in?", formato: "Parágrafo, opcional" },
    ],
  },
  {
    id: "ee",
    nome: "Pós-estruturação estratégica",
    titulo: "Pesquisa de Satisfação EE | Ruston & Co",
    abertura: "Esta pesquisa rápida leva menos de 2 minutos. Seu feedback é fundamental para sabermos se a Estruturação Estratégica (Marketing e Vendas) trouxe clareza sobre os pontos cegos e gargalos do seu negócio.",
    perguntas: [
      { p: "E-mail", formato: "Coletado pelo formulário, obrigatória" },
      { p: "Nome da Empresa", formato: "Resposta curta, obrigatória" },
      { p: "De 0 a 5, quão satisfeito você ficou com a profundidade do Diagnóstico entregue?", formato: "Escala linear 0 a 5, obrigatória", respostas: ["0 (Nada satisfeito)", "5 (Muito satisfeito)"] },
      { p: "Como avalia as análises e gargalos apontados em Vendas, Marketing, Redes e Cliente Oculto?", formato: "Escala linear 0 a 5, obrigatória", respostas: ["0 (Nada satisfeito)", "5 (Muito satisfeito)"] },
      { p: "O diagnóstico trouxe clareza sobre os reais pontos cegos do seu negócio hoje?", formato: "Caixas de seleção, obrigatória", respostas: ["Sim", "Parcialmente", "Não"] },
      { p: "Qual foi o principal aprendizado ou descoberta que você teve com essa entrega?", formato: "Parágrafo, opcional" },
    ],
  },
];

function formularioEmTexto(f: Formulario): string {
  const linhas = [f.titulo];
  if (f.abertura) linhas.push("", f.abertura);
  f.perguntas.forEach((q, i) => {
    linhas.push("", `${i + 1}. ${q.p}`, `   Formato: ${q.formato}`);
    q.respostas?.forEach((r) => linhas.push(`   - ${r}`));
  });
  return linhas.join("\n");
}

/* ------------------------------ Pilar 3 ------------------------------ */

const FLAGS = [
  { nome: "GREEN", cor: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", texto: "Cliente satisfeito. O plano segue." },
  { nome: "YELLOW · aqui agimos", cor: "border-amber-500/50 bg-amber-500/15 text-amber-300", texto: "Apareceu insatisfação em alguma pesquisa ou sinal. O CS começa agora." },
  { nome: "RED", cor: "border-red-500/40 bg-red-500/10 text-red-300", texto: "Risco de churn. É o ponto que o processo existe para evitar." },
];

const GATILHOS_YELLOW = [
  "Nota 0 a 3 em qualquer pesquisa da unidade (planejamento, check-in, EE)",
  "\"Ruim\" ou \"Neutra\" na satisfação geral do check-in",
  "\"Não entendi os próximos passos\" ou \"apresentação confusa\" no check-in",
  "NPS da rede de 0 a 6 (detrator)",
  "Stakeholder sumido, faltando a reuniões ou trocou de interlocutor",
  "Resultado abaixo da meta do cliente ou entrega atrasada",
];

const ROTINAS = [
  { freq: "Toda semana", nome: "Reunião por time", texto: "Por time, não por squad. Cliente por cliente: pontos de atenção, flag definida e ação já combinada." },
  { freq: "1x por mês", nome: "Red Room", texto: "Encontro com a diretoria para falar só de problemas nos clientes e sair com as soluções." },
  { freq: "Antes do ruído", nome: "CS curto", texto: "Processo enxuto para atuar junto ao cliente antes que a insatisfação vire ruído." },
];

const FLUXO_CS = [
  { etapa: "Levantar a mão para a coordenação", prazo: "Dia 1", texto: "O AM alerta a coordenação sobre o problema." },
  { etapa: "Solicitar CS", prazo: "Dia 1", texto: "Acionamento oficial do CS/coordenador para apoiar a demanda." },
  { etapa: "FCA + resumo", prazo: "Até o dia 2 · urgente", texto: "Dossiê: Fato, Causa e Ação, com o que está bom e o que está ruim, onde há satisfação e onde há insatisfação.", link: { href: "/fca", label: "Abrir FCA" } },
  { etapa: "Review do FCA (leitura conjunta)", prazo: "Até o dia 3", texto: "Diretoria e coordenação leem o dossiê juntas antes do contato com o cliente." },
  { etapa: "Agendar reunião", prazo: "Até o dia 4", texto: "Reunião com o stakeholder para escutar, entender a causa e balizar expectativas.", link: { href: "/reunioes", label: "Reuniões" } },
  { etapa: "Alinhamento de ações", prazo: "Até o dia 5", texto: "Nova estratégia, prazos e responsáveis. Acompanhar até a flag voltar a green.", link: { href: "/health-score", label: "Radar de Churn" } },
];

/* ------------------------------ Implantação ------------------------------ */

const CHECKLIST: { grupo: string; itens: string[] }[] = [
  {
    grupo: "Pilar 1 · Cadência de solicitação (começar por aqui)",
    itens: [
      "Incluir o QR Code do NPS no slide final do check-in da 1ª semana do mês",
      "Treinar o squad para pedir a avaliação ao vivo e aguardar o cliente responder",
      "Definir o fluxo de reforço: grupo do cliente, depois privado do stakeholder",
      "Envolver o coordenador (mensagem e ligação) no quarter e com quem não respondeu",
    ],
  },
  {
    grupo: "Pilar 2 · Pulso firme em cada entrega",
    itens: [
      "Criar os formulários: pós-planejamento, pós-check-in e pós-EE",
      "Colocar o QR Code no fim de cada entrega e reforçar o link no grupo",
      "Manter as pesquisas da unidade curtas e leves, com notas de 0 a 5",
      "Definir quem acompanha as respostas e com que frequência",
    ],
  },
  {
    grupo: "Pilar 3 · CS preventivo",
    itens: [
      "Criar a reunião semanal por time para definir a flag e a ação de cada cliente",
      "Marcar o Red Room mensal com a diretoria",
      "Validar com os coordenadores os gatilhos de flag yellow",
      "Usar o FCA como dossiê do cliente",
      "Definir quem conduz a reunião com o stakeholder",
      "Registrar o novo plano e acompanhar até a flag voltar a green",
    ],
  },
  {
    grupo: "Meta é rei · Além da nota",
    itens: [
      "Levar ações, metas, problemas e insatisfações para a review semanal",
      "Acompanhar a meta por rede, unidade, coordenação e squad",
      "Ler as respostas abertas procurando necessidades fora do escopo",
      "Levar essas oportunidades para uma conversa de escopo extra",
    ],
  },
];

const CHAVE_CHECK = "ruston_playbook_nps_check";

/* ============================== Componentes ============================== */

function Titulo({ kicker, titulo, texto }: { kicker: string; titulo: string; texto: string }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">{kicker}</p>
      <h2 className="text-xl font-bold">{titulo}</h2>
      <p className="mt-1 max-w-3xl text-sm text-brand-muted">{texto}</p>
    </div>
  );
}

function BotaoCopiar({ texto, label = "Copiar" }: { texto: string; label?: string }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch { /* sem permissão de clipboard */ }
  }
  return (
    <button onClick={copiar} className="btn-ghost px-3 py-1 text-xs">
      {ok ? "✓ Copiado" : label}
    </button>
  );
}

function Destaque({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-l-4 border-brand bg-brand/10 px-4 py-3 text-sm font-semibold uppercase tracking-wide">
      {children}
    </div>
  );
}

/* ============================== Página ============================== */

export default function PlaybookNpsPage() {
  const [aba, setAba] = useState<Aba>("geral");
  const [formAberto, setFormAberto] = useState<string>(FORMULARIOS[0].id);
  const [feitos, setFeitos] = useState<string[]>([]);

  // Checklist fica salvo no navegador de cada pessoa
  useEffect(() => {
    try { setFeitos(JSON.parse(localStorage.getItem(CHAVE_CHECK) ?? "[]")); } catch { /* sem localStorage */ }
  }, []);
  function marcar(item: string) {
    setFeitos((f) => {
      const novo = f.includes(item) ? f.filter((x) => x !== item) : [...f, item];
      try { localStorage.setItem(CHAVE_CHECK, JSON.stringify(novo)); } catch { /* ignora */ }
      return novo;
    });
  }
  const totalItens = CHECKLIST.reduce((s, g) => s + g.itens.length, 0);
  const totalFeitos = CHECKLIST.reduce((s, g) => s + g.itens.filter((i) => feitos.includes(i)).length, 0);

  const form = FORMULARIOS.find((f) => f.id === formAberto) ?? FORMULARIOS[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📘 Playbook NPS</h1>
        <p className="text-sm text-brand-muted">
          NPS com volume e qualidade: método da V4 Barcellos & Co. adaptado para a Ruston. Satisfação é processo, não sorte.
        </p>
      </div>

      <SubAbas abas={ABAS} ativa={aba} onChange={setAba} />

      {/* ------------------------------ VISÃO GERAL ------------------------------ */}
      {aba === "geral" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { n: "01", t: "Cadência de solicitação", d: "O cliente é convidado a responder o NPS da rede em até 4 pontos de contato.", a: "cadencia" as Aba, tag: "Volume" },
              { n: "02", t: "Pulso firme em cada entrega", d: "Toda entrega relevante gera uma pesquisa própria, curta e leve.", a: "pulso" as Aba, tag: "Qualidade" },
              { n: "03", t: "CS preventivo", d: "Qualquer sinal de insatisfação abre um processo de CS antes que o ruído vire churn.", a: "cs" as Aba, tag: "Qualidade" },
            ].map((p) => (
              <button key={p.n} onClick={() => setAba(p.a)} className="card text-left transition hover:border-brand/50">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-black text-brand">{p.n}</span>
                  <span className="badge border-white/10 text-brand-muted">{p.tag}</span>
                </div>
                <p className="mt-2 font-semibold">{p.t}</p>
                <p className="mt-1 text-sm text-brand-muted">{p.d}</p>
              </button>
            ))}
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold">Rotina da semana e do mês</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-brand-muted">
                <tr><th className="pb-2">Quando</th><th className="pb-2">O quê</th><th className="pb-2">Quem</th></tr>
              </thead>
              <tbody className="text-gray-300">
                {[
                  ["1ª semana do mês", "QR Code do NPS da rede no check-in + régua de reforço", "Squad"],
                  ["Toda entrega", "QR Code da pesquisa da unidade + link no grupo", "Squad"],
                  ["Toda semana", "Reunião por time: flag de cada cliente + review de metas", "Coordenador"],
                  ["Flag yellow", "Fluxo de CS em 5 dias com FCA", "AM + Coordenador"],
                  ["1x por mês", "Red Room com a diretoria", "Gerente"],
                  ["Quarter", "Coordenador liga para quem não respondeu", "Coordenador"],
                ].map(([q, o, w]) => (
                  <tr key={o} className="border-t border-white/5">
                    <td className="py-2 font-medium text-gray-100">{q}</td><td className="py-2">{o}</td><td className="py-2">{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold">O que sustenta o resultado</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
              <li>Pedir mais de uma vez, por mais de um canal: a resposta raramente vem no primeiro convite.</li>
              <li>Medir sempre, de forma leve: quem pergunta toda semana não é surpreendido no quarter.</li>
              <li>Ter rotina para olhar o cliente: reunião semanal por time, Red Room mensal e CS curto.</li>
              <li>Agir antes do ruído: yellow é o momento de atuar, red já é tarde.</li>
              <li>Meta é rei: a meta orienta a review da semana, de ponta a ponta.</li>
              <li>Estar perto: a proximidade que melhora a nota também revela novos projetos.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ------------------------------ PILAR 1 ------------------------------ */}
      {aba === "cadencia" && (
        <div className="space-y-6">
          <Titulo kicker="Pilar 01 · Cadência do NPS" titulo="Pedimos até 4 vezes"
            texto="O cliente não recebe um link e é esquecido. É convidado até 4 vezes, por canais e pessoas diferentes, a partir da 1ª semana do mês. Cada etapa só entra se a anterior não teve resposta." />
          <div className="grid gap-3 md:grid-cols-4">
            {CADENCIA.map((c, i) => (
              <div key={c.etapa} className="card">
                <p className="text-2xl font-black text-brand">{i + 1}</p>
                <p className="font-semibold">{c.etapa}</p>
                <p className="mt-1 text-xs text-brand-muted">{c.quando}</p>
                <p className="mt-2 text-xs"><span className="text-brand-muted">Quem:</span> {c.quem}</p>
                <p className="text-xs"><span className="text-brand-muted">Canal:</span> {c.canal}</p>
                <p className="mt-2 text-sm text-gray-300">{c.como}</p>
              </div>
            ))}
          </div>
          <Destaque>Muda o canal. Sobe quem pede.</Destaque>
          <p className="text-sm text-brand-muted">
            Por que funciona: o primeiro pedido acontece ao vivo, com o cliente engajado e o resultado recém-apresentado. As etapas seguintes não repetem o pedido: mudam o canal e sobem o nível de quem pede.
          </p>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Roteiros prontos</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {ROTEIROS.map((r) => (
                <div key={r.titulo} className="card">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{r.titulo}</p>
                    <BotaoCopiar texto={r.texto} />
                  </div>
                  <p className="text-sm italic text-gray-300">&ldquo;{r.texto}&rdquo;</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-brand-muted">Regra: o coordenador pede a resposta, nunca a nota. Pedir nota infla o NPS e esconde problemas.</p>
          </div>
        </div>
      )}

      {/* ------------------------------ PILAR 2 ------------------------------ */}
      {aba === "pulso" && (
        <div className="space-y-6">
          <Titulo kicker="Pilar 02 · Pulso firme" titulo="Pesquisa em cada entrega"
            texto="Toda entrega relevante termina com uma pesquisa da unidade. Medimos a satisfação reunião a reunião e chegamos ao NPS da rede já sabendo como o cliente se sente." />

          <div className="card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-brand-muted">
                <tr><th className="pb-2">Momento</th><th className="pb-2">Pesquisa</th><th className="pb-2">O que medimos</th></tr>
              </thead>
              <tbody className="text-gray-300">
                {PESQUISAS.map((p) => (
                  <tr key={p.pesquisa} className="border-t border-white/5 align-top">
                    <td className="py-2 font-medium text-gray-100">{p.momento}</td><td className="py-2">{p.pesquisa}</td><td className="py-2">{p.mede}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">Como a pesquisa chega ao cliente</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-300">
                <li><b>QR Code na reunião:</b> no fim de cada entrega, o QR Code aparece na tela e o cliente responde ali mesmo.</li>
                <li><b>Link no grupo:</b> depois da reunião, o link vai no grupo do cliente com um incentivo para responder.</li>
              </ol>
            </div>
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">&ldquo;Mas não fica pesquisa demais?&rdquo;</h3>
              <p className="text-sm text-gray-300">Quando responder vira parte natural de cada reunião, o cliente cria o hábito e deixa de sentir peso. A regra é dosar o tom:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-300">
                <li><b>Pesquisas da unidade:</b> leves, rápidas, no fluxo da conversa.</li>
                <li><b>NPS da rede:</b> pedido enfático e insistente, com a cadência do Pilar 1.</li>
              </ul>
            </div>
          </div>

          <div className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Formulários prontos</h3>
                <p className="text-xs text-brand-muted">Menos de 2 minutos cada. Copie e cole no Google Forms.</p>
              </div>
              <div className="inline-flex rounded-lg border border-white/10 p-1">
                {FORMULARIOS.map((f) => (
                  <button key={f.id} onClick={() => setFormAberto(f.id)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${formAberto === f.id ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"}`}>
                    {f.nome}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{form.titulo}</p>
                {form.abertura && <p className="mt-1 max-w-3xl text-sm italic text-gray-300">&ldquo;{form.abertura}&rdquo;</p>}
              </div>
              <BotaoCopiar texto={formularioEmTexto(form)} label="Copiar formulário inteiro" />
            </div>
            <ol className="space-y-3">
              {form.perguntas.map((q, i) => (
                <li key={q.p} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <p className="text-sm font-medium">{i + 1}. {q.p}</p>
                  <p className="text-xs text-brand-muted">{q.formato}</p>
                  {q.respostas && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-gray-300">
                      {q.respostas.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* ------------------------------ PILAR 3 ------------------------------ */}
      {aba === "cs" && (
        <div className="space-y-6">
          <Titulo kicker="Pilar 03 · CS preventivo" titulo="Agimos no yellow, não no red"
            texto="Se qualquer pesquisa ou sinal da semana mostra insatisfação, abrimos um processo de CS na hora, sem esperar a flag chegar em red." />

          <div className="grid gap-3 md:grid-cols-3">
            {FLAGS.map((f) => (
              <div key={f.nome} className={`rounded-xl border p-4 ${f.cor}`}>
                <p className="text-sm font-bold">{f.nome}</p>
                <p className="mt-1 text-sm text-gray-200">{f.texto}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">O que dispara a flag yellow</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
              {GATILHOS_YELLOW.map((g) => <li key={g}>{g}</li>)}
            </ul>
            <p className="mt-2 text-xs text-brand-muted">Proposta inicial. Valide os gatilhos com os coordenadores.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {ROTINAS.map((r) => (
              <div key={r.nome} className="card">
                <p className="text-xs font-semibold uppercase text-brand">{r.freq}</p>
                <p className="font-semibold">{r.nome}</p>
                <p className="mt-1 text-sm text-gray-300">{r.texto}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 className="mb-1 text-sm font-semibold">Tratativa de CS · flag yellow em 5 dias</h3>
            <p className="mb-4 text-xs text-brand-muted">Disparado ao identificar uma flag yellow nas reuniões semanais. Pode ser automatizado como fluxo no Ekyte.</p>
            <ol className="relative space-y-4 border-l border-white/10 pl-6">
              {FLUXO_CS.map((e, i) => (
                <li key={e.etapa} className="relative">
                  <span className="absolute -left-[34px] flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold">{i + 1}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{e.etapa}</p>
                    <span className="badge border-amber-500/40 text-amber-300">{e.prazo}</span>
                    {e.link && <Link href={e.link.href} className="text-xs text-brand hover:underline">{e.link.label} →</Link>}
                  </div>
                  <p className="text-sm text-gray-300">{e.texto}</p>
                </li>
              ))}
            </ol>
          </div>
          <Destaque>O dossiê faz a reunião com o stakeholder começar com diagnóstico, não com defesa.</Destaque>
        </div>
      )}

      {/* ------------------------------ META É REI ------------------------------ */}
      {aba === "meta" && (
        <div className="space-y-6">
          <Titulo kicker="Dica extra · virada de chave" titulo="Meta é rei"
            texto="Toda semana a review com o time passa por ações, metas, problemas e insatisfações, do cliente ou do próprio time, e define onde atuar." />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">Pauta da review semanal</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-300">
                <li>Ações da semana: o que foi feito e o que ficou</li>
                <li>Metas: onde estamos contra a meta</li>
                <li>Problemas: o que está travando</li>
                <li>Insatisfações do cliente e do time</li>
                <li>Saída: cada pessoa sabe onde atuar</li>
              </ol>
              <Link href="/metas" className="btn-ghost mt-4 text-xs">Ver Metas →</Link>
            </div>
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">A meta de ponta a ponta</h3>
              <div className="space-y-1.5">
                {["Rede", "Regional", "Unidade", "Coordenação", "Squad"].map((n, i) => (
                  <div key={n} className="rounded-md bg-brand/15 py-1.5 text-center text-xs font-semibold uppercase tracking-wide"
                    style={{ marginLeft: `${i * 6}%`, marginRight: `${i * 6}%` }}>{n}</div>
                ))}
              </div>
            </div>
          </div>
          <Destaque>Meta é rei: o time sai da review sabendo onde atuar.</Destaque>

          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">Além da nota: a conexão também gera monetização</h3>
            <p className="text-sm text-gray-300">
              Perto do cliente, aparecem necessidades fora do escopo contratado. As respostas abertas dos formulários, os check-ins e as reuniões de CS são onde essas expectativas surgem. Leve-as para uma conversa de escopo extra.
            </p>
            <Link href="/monetizacao" className="btn-ghost mt-4 text-xs">Registrar em Monetização →</Link>
          </div>
        </div>
      )}

      {/* ------------------------------ IMPLANTAÇÃO ------------------------------ */}
      {aba === "implantar" && (
        <div className="space-y-6">
          <Titulo kicker="Passo a passo" titulo="Como implantar na unidade"
            texto="Comece pela cadência do NPS, que dá resultado já no primeiro ciclo. As pesquisas próprias e o CS preventivo entram em seguida e sustentam a nota no longo prazo." />
          <div className="card">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">Progresso</span>
              <span className="text-brand-muted">{totalFeitos} de {totalItens}</span>
            </div>
            <div className="h-2 rounded-full bg-white/5">
              <div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${(totalFeitos / totalItens) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-brand-muted">O progresso fica salvo neste navegador.</p>
          </div>
          {CHECKLIST.map((g) => (
            <div key={g.grupo} className="card">
              <h3 className="mb-3 text-sm font-semibold">{g.grupo}</h3>
              <ul className="space-y-2">
                {g.itens.map((it) => (
                  <li key={it}>
                    <label className="flex cursor-pointer items-start gap-3 text-sm">
                      <input type="checkbox" checked={feitos.includes(it)} onChange={() => marcar(it)} className="mt-0.5 accent-[#e11d2a]" />
                      <span className={feitos.includes(it) ? "text-brand-muted line-through" : "text-gray-200"}>{it}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
