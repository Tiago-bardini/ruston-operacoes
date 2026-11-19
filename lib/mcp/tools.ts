// =====================================================================
// MCP — ferramentas que a IA pode usar
// Cada ferramenta: nome, descrição (a IA lê para decidir quando usar),
// esquema de entrada (JSON Schema) e a função que executa como o usuário.
// Gravações passam por lib/mcp/envios.ts (permissão, prazo e histórico).
// =====================================================================

import type { UsuarioMcp, PapelMcp } from "@/lib/mcp/auth";
import { calcularNotaFinalFca, bandeiraDaNota, sextaDaSemanaFca, ETAPA_LABEL } from "@/lib/types";
import { calcularRoi } from "@/lib/planejamento";
import {
  diaMes, hojeIsoBr, mesFechadoEm, prazoDaSemana, resumoMeta, rotuloSemana, semanaAnterior, semanaCobrada, semanaLancada, fimDaSemana, semanasDoMes,
  type MetaMensal, type MetaSemanal,
} from "@/lib/metasClientes";
import { formularioDe, nomePesquisa, perguntaVisivel, type Pesquisa } from "@/lib/pesquisas";
import {
  ABERTOS, PRAZO_EDICAO_DIAS, TIPOS, aplicarEdicao, apagarRegistro, carregarEnvio, conferirPermissao, criarRegistro,
  desfazer, diferenca, ehGestao, montarPatch, prazoDe, registrarHistorico, tipoDaTabela, type TipoEnvio,
} from "@/lib/mcp/envios";

type Args = Record<string, any>;

export type Ferramenta = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, any>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean };
  papeis?: PapelMcp[];  // vazio = todos os papéis do MCP
  run: (u: UsuarioMcp, a: Args) => Promise<unknown>;
};

const CONFIRMAR = " Antes de chamar, mostre ao usuário exatamente o que será gravado e peça confirmação.";
const DUAS_ETAPAS = " Funciona em duas etapas: chame sem confirmar para receber a prévia (antes/depois), mostre ao usuário e, só depois do OK dele, chame de novo com confirmar=true.";

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const mesValido = (m: any) => Number.isInteger(m) && m >= 1 && m <= 12;
const hojeBr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const dataHoraBr = (d: Date) => d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

function ok<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** Clientes que o usuário enxerga (coordenador/gestor: só o squad). */
async function carteira(u: UsuarioMcp, incluirInativos = false) {
  let q = u.supabase.from("ruston_clientes_view")
    .select("id, nome, codigo_interno, etapa, mrr, fee, tier, ativo, churn_realizado, squad_id, squad_nome, coordenador_nome, account_nome, gestor_trafego_nome, data_assinatura, data_vencimento_contrato")
    .order("nome");
  if (!incluirInativos) q = q.eq("ativo", true);
  if (u.squadId) q = q.eq("squad_id", u.squadId);
  return ok(await q) as any[];
}

/** Acha UM cliente por id ou nome (tolerante a acento, caixa e nome parcial). */
async function acharCliente(u: UsuarioMcp, ref: string) {
  if (!ref?.trim()) throw new Error("Informe o cliente (nome ou id).");
  const lista = await carteira(u, true);
  const porId = lista.find((c) => c.id === ref.trim());
  if (porId) return porId;
  const n = normalizar(ref);
  const exatos = lista.filter((c) => normalizar(c.nome) === n);
  const candidatos = exatos.length ? exatos : lista.filter((c) => normalizar(c.nome).includes(n) || n.includes(normalizar(c.nome)));
  const ativos = candidatos.filter((c) => c.ativo);
  const final = ativos.length ? ativos : candidatos;
  if (final.length === 1) return final[0];
  if (final.length === 0) throw new Error(`Cliente "${ref}" não encontrado${u.squadId ? " no seu squad" : ""}. Use buscar_clientes.`);
  throw new Error(`Mais de um cliente bate com "${ref}": ${final.slice(0, 10).map((c) => c.nome).join(", ")}. Seja mais específico.`);
}

/** Pessoa do time por nome ou e-mail (responsável de churn). null limpa. */
async function acharPessoa(u: UsuarioMcp, ref: string | null | undefined): Promise<{ id: string; nome: string } | null> {
  if (ref === null) return null;
  if (!ref?.trim()) throw new Error("Informe o responsável (nome ou e-mail).");
  const pessoas = ok(await u.supabase.from("ruston_pessoas").select("id, nome, email").eq("ativo", true)) as any[];
  const n = normalizar(ref);
  const achou = pessoas.filter((p) => p.id === ref || (p.email && p.email.toLowerCase() === ref.toLowerCase()) || normalizar(p.nome).includes(n));
  if (achou.length === 1) return { id: achou[0].id, nome: achou[0].nome };
  if (!achou.length) throw new Error(`Pessoa "${ref}" não encontrada no time.`);
  throw new Error(`Mais de uma pessoa bate com "${ref}": ${achou.slice(0, 8).map((p) => p.nome).join(", ")}.`);
}

const nomesClientes = async (u: UsuarioMcp) => new Map((await carteira(u, true)).map((c) => [c.id, c.nome as string]));

function infoPrazo(u: UsuarioMcp, tipo: TipoEnvio, row: any) {
  if (ehGestao(u)) return { pode_alterar_ate: "sem prazo (Coordenador/Gerente)" };
  if (row.criado_por_id !== u.userId) return { pode_alterar_ate: "só Coordenador/Gerente (não foi você que criou)" };
  const limite = prazoDe(tipo, row);
  const restam = limite.getTime() - Date.now();
  return {
    pode_alterar_ate: dataHoraBr(limite),
    tempo_restante: restam <= 0 ? "encerrado" : restam > 86_400_000 ? `${Math.floor(restam / 86_400_000)} dia(s)` : `${Math.ceil(restam / 3_600_000)} hora(s)`,
  };
}

function fcaResumo(f: any) {
  const nota = f.nota_final ?? calcularNotaFinalFca(f);
  return {
    id: f.id, data_referencia: f.data_referencia, semana: `sexta ${f.data_referencia?.split("-").reverse().join("/")}`,
    status: f.status, nota_final: nota, bandeira: f.bandeira ?? bandeiraDaNota(nota),
    notas: { resultado: f.nota_resultado, operacao_trafego: f.nota_operacao_trafego, prazo: f.nota_prazo, qualidade: f.nota_qualidade, relacionamento: f.nota_relacionamento, roi: f.nota_roi },
    fato: f.fato, causa: f.causa, acao: f.acao, observacoes: f.observacoes, origem: f.origem,
  };
}

function resumoEnvio(tipo: TipoEnvio, r: any) {
  if (!r) return null;
  switch (tipo) {
    case "fca": return { data_referencia: r.data_referencia, status: r.status, nota_final: calcularNotaFinalFca(r), fato: r.fato?.slice(0, 120) };
    case "roi": case "ponto_equilibrio": return { mes: `${String(r.mes).padStart(2, "0")}/${r.ano}`, ...r.dados };
    case "tratativa_churn": return { status: r.status, risco: r.risco, motivo: r.motivo, prazo: r.prazo };
    case "acompanhamento_churn": return { data_acao: r.data_acao, tipo: r.tipo, descricao: r.descricao?.slice(0, 120), resultado: r.resultado };
  }
}

const NOTA = { type: ["number", "null"], minimum: 0, maximum: 10 };
const CLIENTE = { type: "string", description: "Nome do cliente (pode ser parcial) ou id" };
const CONFIRMA = { type: "boolean", description: "true só depois que o usuário aprovou a prévia" };
const TEXTO_OU_NULL = { type: ["string", "null"] };
const TIPOS_ACAO = ["reuniao_stakeholder", "ligacao", "ajuste_entrega", "troca_time", "negociacao", "fca_dossie", "outro"];

export const FERRAMENTAS: Ferramenta[] = [
  // ============================================================ CLIENTES
  {
    name: "buscar_clientes",
    title: "Listar / buscar clientes",
    description: "Lista os clientes ativos da carteira (o coordenador e o gestor veem só o próprio squad). Filtro opcional por parte do nome, etapa ou squad.",
    inputSchema: {
      type: "object",
      properties: {
        busca: { type: "string", description: "Parte do nome" },
        etapa: { type: "string", enum: Object.keys(ETAPA_LABEL) },
        squad: { type: "string", description: "Nome do squad" },
        gp: { type: "string", description: "Nome (ou parte) do GP/Account" },
        incluir_inativos: { type: "boolean" },
        limite: { type: "integer", default: 100, description: "Máx. 200 por página" },
        pagina: { type: "integer", default: 1 },
      },
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      let lista = await carteira(u, !!a.incluir_inativos);
      if (a.busca) lista = lista.filter((c) => normalizar(c.nome).includes(normalizar(a.busca)));
      if (a.etapa) lista = lista.filter((c) => c.etapa === a.etapa);
      if (a.squad) lista = lista.filter((c) => normalizar(c.squad_nome ?? "").includes(normalizar(a.squad)));
      if (a.gp) lista = lista.filter((c) => normalizar(c.account_nome ?? "").includes(normalizar(a.gp)));
      const limite = Math.min(Math.max(Number(a.limite) || 100, 1), 200);
      const pagina = Math.max(Number(a.pagina) || 1, 1);
      const total = lista.length;
      lista = lista.slice((pagina - 1) * limite, pagina * limite);
      return {
        total, pagina, paginas: Math.max(Math.ceil(total / limite), 1),
        clientes: lista.map((c) => ({
          id: c.id, nome: c.nome, etapa: ETAPA_LABEL[c.etapa as keyof typeof ETAPA_LABEL] ?? c.etapa,
          mrr: c.mrr, fee: c.fee, tier: c.tier, squad: c.squad_nome, coordenador: c.coordenador_nome,
          account: c.account_nome, gestor_trafego: c.gestor_trafego_nome,
          assinatura: c.data_assinatura, vencimento_contrato: c.data_vencimento_contrato, ativo: c.ativo,
        })),
      };
    },
  },
  {
    name: "ver_cliente",
    title: "Ver ficha do cliente",
    description: "Ficha de um cliente: cadastro, últimos FCAs, tratativas de churn, ROI dos últimos meses, pesquisas, entregáveis previstos, oportunidades de monetização e a meta do mês.",
    inputSchema: { type: "object", properties: { cliente: CLIENTE }, required: ["cliente"] },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const { ano, mes } = anoMesPadrao({});
      const [fcas, trat, roi, pesq, entregas, mon, meta, semanas] = await Promise.all([
        u.supabase.from("ruston_fca_view").select("*").eq("cliente_id", c.id).order("data_referencia", { ascending: false }).limit(4),
        u.supabase.from("ruston_churn_solicitacoes").select("id, data_solicitacao, status, risco, motivo, prazo, encerrado_em, motivo_final")
          .eq("cliente_id", c.id).order("data_solicitacao", { ascending: false }).limit(5),
        u.supabase.from("ruston_cliente_roi_mensal").select("ano, mes, dados")
          .eq("cliente_id", c.id).order("ano", { ascending: false }).order("mes", { ascending: false }).limit(3),
        u.supabase.from("ruston_pesquisas").select("tipo, semana_ee, criada_em, respondida_em, nota")
          .eq("cliente_id", c.id).eq("cancelada", false).order("criada_em", { ascending: false }).limit(5),
        u.supabase.from("ruston_entregas_view").select("tipo_entrega_nome, tipo_entrega_categoria, quantidade_mensal, quantidade_texto, percentual_alocacao, valor_mensal")
          .eq("cliente_id", c.id).eq("ativo", true),
        u.supabase.from("ruston_monetizacao_view").select("titulo, estagio, valor_mrr_estimado, valor_onetime_estimado, probabilidade, data_prevista_fechamento, data_ganho, dias_parado")
          .eq("cliente_id", c.id).eq("ativo", true),
        u.supabase.from("ruston_cliente_metas_mensal").select("*").eq("cliente_id", c.id).eq("ano", ano).eq("mes", mes).maybeSingle(),
        u.supabase.from("ruston_cliente_metas_semanal").select("*").eq("cliente_id", c.id).eq("ano", ano).eq("mes", mes),
      ]);
      // Blocos novos não derrubam a ficha se uma tabela falhar
      const seguro = (r: { data: any; error: any }) => (r.error ? { erro: r.error.message } : r.data);
      const metaMes = meta.error || semanas.error ? null : linhaMeta(c, meta.data as MetaMensal | null, (semanas.data ?? []) as MetaSemanal[], ano, mes, hojeIsoBr());
      return {
        cliente: c,
        fca_recentes: (ok(fcas) as any[]).map(fcaResumo),
        tratativas_churn: ok(trat),
        roi_recente: ok(roi),
        pesquisas: (ok(pesq) as any[]).map((p) => ({ ...p, nome: nomePesquisa(p.tipo, p.semana_ee) })),
        entregaveis: seguro(entregas),
        monetizacao: seguro(mon),
        meta_do_mes: metaMes ? { mes: `${String(mes).padStart(2, "0")}/${ano}`, situacao: metaMes.situacao, leads: metaMes.leads, faturamento: metaMes.faturamento, semanas_sem_lancar: metaMes.semanas_sem_lancar } : null,
      };
    },
  },
  {
    name: "cadastrar_cliente",
    title: "Cadastrar cliente",
    description: "Cadastra um novo cliente na carteira. Confira antes com buscar_clientes se ele já não existe." + CONFIRMAR,
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        etapa: { type: "string", enum: ["onboarding", "estruturacao_estrategica", "byline", "pontual"], description: "Padrão: onboarding" },
        mrr: { type: "number", description: "Valor mensal (R$)" },
        fee: { type: "number" },
        tier: { type: "string", enum: ["tiny", "small", "medium", "large"] },
        codigo_interno: { type: "string" },
        data_assinatura: { type: "string", description: "AAAA-MM-DD" },
        prazo_contrato_meses: { type: "integer" },
        squad: { type: "string", description: "Nome do squad (coordenador/gestor: sempre o próprio)" },
        whatsapp: { type: "string", description: "Números separados por vírgula" },
        contrato_url: { type: "string" },
        observacoes: { type: "string" },
      },
      required: ["nome", "mrr"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    papeis: ["gerente", "coordenador"],
    async run(u, a) {
      const nome = String(a.nome ?? "").trim();
      if (nome.length < 2) throw new Error("Nome inválido.");
      const existentes = await carteira(u, true);
      const igual = existentes.find((c) => normalizar(c.nome) === normalizar(nome));
      if (igual) throw new Error(`Já existe o cliente "${igual.nome}" (id ${igual.id}).`);

      let squadId = u.squadId;
      if (!squadId && a.squad) {
        const squads = ok(await u.supabase.from("ruston_squads").select("id, nome").eq("ativo", true)) as any[];
        const s = squads.find((x) => normalizar(x.nome).includes(normalizar(a.squad)));
        if (!s) throw new Error(`Squad "${a.squad}" não encontrado. Squads: ${squads.map((x) => x.nome).join(", ")}`);
        squadId = s.id;
      }
      let vencimento: string | null = null;
      if (a.data_assinatura && a.prazo_contrato_meses) {
        const d = new Date(a.data_assinatura + "T00:00:00");
        d.setMonth(d.getMonth() + Number(a.prazo_contrato_meses));
        vencimento = d.toISOString().slice(0, 10);
      }
      const payload = {
        nome,
        etapa: a.etapa ?? "onboarding",
        mrr: Number(a.mrr) || 0,
        fee: a.fee ?? null,
        tier: a.tier ?? null,
        codigo_interno: a.codigo_interno ?? null,
        data_assinatura: a.data_assinatura ?? null,
        prazo_contrato_meses: a.prazo_contrato_meses ?? null,
        data_vencimento_contrato: vencimento,
        squad_id: squadId,
        whatsapp: a.whatsapp
          ? String(a.whatsapp).split(",").map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 10).join(",") || null
          : null,
        contrato_url: a.contrato_url ?? null,
        observacoes: a.observacoes ?? null,
      };
      const novo = ok(await u.supabase.from("ruston_clientes").insert(payload).select("*").single()) as any;
      await registrarHistorico(u, "ruston_clientes", "criar", null, novo);
      return { ok: true, cliente: { id: novo.id, nome: novo.nome } };
    },
  },

  // ============================================================ FCA
  {
    name: "ver_fca",
    title: "Ver FCA do cliente",
    description: "Histórico de FCA (Fato, Causa, Ação + notas) de um cliente, do mais recente para o mais antigo. O FCA é semanal: cada registro tem data_referencia (sempre uma sexta-feira).",
    inputSchema: { type: "object", properties: { cliente: CLIENTE, limite: { type: "integer", default: 6 } }, required: ["cliente"] },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const fcas = ok(await u.supabase.from("ruston_fca_view").select("*").eq("cliente_id", c.id)
        .order("data_referencia", { ascending: false }).limit(Math.min(a.limite ?? 6, 30))) as any[];
      return { cliente: c.nome, sexta_desta_semana: sextaDaSemanaFca(), fcas: fcas.map(fcaResumo) };
    },
  },
  {
    name: "salvar_fca",
    title: "Preencher / editar FCA",
    description:
      "Cria ou atualiza o FCA de um cliente na semana (referência = sexta-feira). Se já existir FCA nessa data, só os campos enviados mudam (null limpa). " +
      "Notas de 0 a 10: resultado (peso 7), operacao_trafego (5), prazo (5), qualidade (4), relacionamento (4), roi (8). " +
      "Status: rascunho, aguardando_validacao ou validado (validar só Gerente/Coordenador). " +
      `Alterar um FCA existente segue a regra de envios (autor em até ${PRAZO_EDICAO_DIAS} dias; FCA validado só Coordenador/Gerente).` + CONFIRMAR,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        data_referencia: { type: "string", description: "Sexta-feira AAAA-MM-DD. Padrão: sexta da semana atual" },
        nota_resultado: NOTA, nota_operacao_trafego: NOTA, nota_prazo: NOTA,
        nota_qualidade: NOTA, nota_relacionamento: NOTA, nota_roi: NOTA,
        fato: TEXTO_OU_NULL, causa: TEXTO_OU_NULL, acao: TEXTO_OU_NULL, observacoes: TEXTO_OU_NULL,
        status: { type: "string", enum: ["rascunho", "aguardando_validacao", "validado"] },
      },
      required: ["cliente"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const dRef: string = a.data_referencia ?? sextaDaSemanaFca();
      const d = new Date(dRef + "T00:00:00");
      if (isNaN(d.getTime())) throw new Error("data_referencia inválida (use AAAA-MM-DD).");
      if (d.getDay() !== 5) throw new Error(`${dRef} não é sexta-feira. O FCA é sempre na sexta (desta semana: ${sextaDaSemanaFca()}).`);
      if (a.status === "validado" && !ehGestao(u)) throw new Error("Só Gerente ou Coordenador valida FCA. Use aguardando_validacao.");

      const campos: Args = {};
      for (const k of TIPOS.fca.campos) if (a[k] !== undefined) campos[k] = a[k];
      validarNotas(campos);
      if (campos.status === "validado") campos.validado_at = new Date().toISOString();

      const existente = ok(await u.supabase.from("ruston_fca").select("*").eq("cliente_id", c.id).eq("data_referencia", dRef).maybeSingle()) as any;
      if (existente) {
        conferirPermissao(u, "fca", existente, "editar");
        if (existente.status === "validado" && campos.status === undefined) campos.status = "aguardando_validacao";
        const { registro, mudancas } = await aplicarEdicao(u, "fca", existente, campos);
        return { ok: true, acao: "atualizado", id: registro.id, cliente: c.nome, data_referencia: dRef, nota_final: calcularNotaFinalFca(registro), status: registro.status, mudancas, ...infoPrazo(u, "fca", registro) };
      }
      const novo = await criarRegistro(u, "fca", {
        ...campos, status: campos.status ?? "rascunho", cliente_id: c.id, data_referencia: dRef, ano: d.getFullYear(), mes: d.getMonth() + 1,
      });
      return { ok: true, acao: "criado", id: novo.id, cliente: c.nome, data_referencia: dRef, nota_final: calcularNotaFinalFca(novo), bandeira: bandeiraDaNota(calcularNotaFinalFca(novo)), status: novo.status, mudancas: diferenca("fca", null, novo), ...infoPrazo(u, "fca", novo) };
    },
  },

  // ============================================================ PLANEJAMENTO / ROI
  {
    name: "ver_planejamento",
    title: "Ver planejamento e ROI",
    description: "Mostra o ponto de equilíbrio do mês, o ROI mensal (com ROAS, ROI e lucro calculados) e o forecast de um cliente.",
    inputSchema: {
      type: "object",
      properties: { cliente: CLIENTE, ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 } },
      required: ["cliente"],
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const [pe, roi, plan] = await Promise.all([
        u.supabase.from("ruston_cliente_pe_mensal").select("id, ano, mes, dados").eq("cliente_id", c.id)
          .order("ano", { ascending: false }).order("mes", { ascending: false }).limit(12),
        u.supabase.from("ruston_cliente_roi_mensal").select("id, ano, mes, dados").eq("cliente_id", c.id)
          .order("ano", { ascending: false }).order("mes", { ascending: false }).limit(12),
        u.supabase.from("ruston_cliente_planejamento").select("forecast, updated_at").eq("cliente_id", c.id).maybeSingle(),
      ]);
      const pes = ok(pe) as any[];
      const rois = (ok(roi) as any[])
        .filter((r) => !a.ano || (r.ano === a.ano && (!a.mes || r.mes === a.mes)))
        .map((r) => {
          const peMes = pes.find((p) => p.ano === r.ano && p.mes === r.mes)?.dados;
          const calc = calcularRoi(r.dados, peMes, Number(c.mrr) || 0);
          return { id: r.id, ano: r.ano, mes: r.mes, preenchido: r.dados, roas: calc.roas, roi_pct: calc.roi != null ? Math.round(calc.roi * 1000) / 10 : null, lucro: calc.lucro, fee_usado: calc.fee, margem_rs: calc.margem };
        });
      return { cliente: c.nome, mrr: c.mrr, roi_mensal: rois, ponto_equilibrio_mensal: pes, forecast: (ok(plan) as any)?.forecast ?? null };
    },
  },
  {
    name: "salvar_roi_mensal",
    title: "Preencher ROI do mês",
    description:
      "Preenche o ROI de um mês do cliente: faturamento (R$), margem_pct (margem de contribuição em %, 40 = 40%), midia (investimento em mídia no mês, R$) e fee_v4 (opcional; vazio usa o fee do planejamento ou o MRR). " +
      "Só os campos enviados mudam (null limpa). Retorna id, ROAS, ROI, lucro, prazo de edição e antes/depois." + CONFIRMAR,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 },
        faturamento: { type: ["number", "null"] }, margem_pct: { type: ["number", "null"] }, midia: { type: ["number", "null"] }, fee_v4: { type: ["number", "null"] },
      },
      required: ["cliente", "ano", "mes"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      if (!mesValido(a.mes)) throw new Error("mes precisa ser de 1 a 12.");
      const c = await acharCliente(u, a.cliente);
      const campos: Args = {};
      for (const k of TIPOS.roi.campos) if (a[k] !== undefined) campos[k] = a[k];
      const r = await salvarMensal(u, "roi", c, a.ano, a.mes, campos);
      const pe = ok(await u.supabase.from("ruston_cliente_pe_mensal").select("dados")
        .eq("cliente_id", c.id).eq("ano", a.ano).eq("mes", a.mes).maybeSingle()) as any;
      const calc = calcularRoi(r.registro.dados, pe?.dados, Number(c.mrr) || 0);
      return { ...r.saida, roas: calc.roas, roi_pct: calc.roi != null ? Math.round(calc.roi * 1000) / 10 : null, lucro: calc.lucro };
    },
  },
  {
    name: "salvar_ponto_equilibrio",
    title: "Preencher ponto de equilíbrio do mês",
    description:
      "Preenche o ponto de equilíbrio (planejamento) de um mês do cliente. Campos: produto, periodo, faturamento, qtd_vendas, " +
      "pct_frete, pct_impostos, pct_custo_produto, pct_gateway, pct_comissao, pct_outros_var (em %), fee_v4, ferramentas, equipe_vendas, outros_fixos (R$), " +
      "pct_cac_alvo, pct_cac_aceitavel (%), cac_alvo_valor (R$). Só os campos enviados mudam (null limpa)." + CONFIRMAR,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 },
        dados: { type: "object", description: "Campos do ponto de equilíbrio a gravar" },
      },
      required: ["cliente", "ano", "mes", "dados"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      if (!mesValido(a.mes)) throw new Error("mes precisa ser de 1 a 12.");
      const c = await acharCliente(u, a.cliente);
      return (await salvarMensal(u, "ponto_equilibrio", c, a.ano, a.mes, a.dados ?? {})).saida;
    },
  },

  // ============================================================ MEUS ENVIOS
  {
    name: "listar_meus_envios",
    title: "Listar meus envios",
    description: `Lista o que você gravou pelo MCP nos últimos ${PRAZO_EDICAO_DIAS} dias (FCA, ROI, ponto de equilíbrio, tratativas e acompanhamentos de churn), com id, cliente, data do envio, até quando dá para alterar e um resumo dos valores. Use quando o usuário disser que enviou algo errado.`,
    inputSchema: {
      type: "object",
      properties: { cliente: CLIENTE, tipo: { type: "string", enum: Object.keys(TIPOS) } },
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const desde = new Date(Date.now() - PRAZO_EDICAO_DIAS * 86_400_000).toISOString();
      let q = u.supabase.from("ruston_historico_envios").select("*").eq("usuario_id", u.userId)
        .gte("criado_em", desde).order("criado_em", { ascending: false }).limit(300);
      if (a.tipo) q = q.eq("tabela", TIPOS[a.tipo as TipoEnvio].tabela);
      else q = q.in("tabela", Object.values(TIPOS).map((t) => t.tabela));
      if (a.cliente) q = q.eq("cliente_id", (await acharCliente(u, a.cliente)).id);
      const hist = ok(await q) as any[];

      const ultimo = new Map<string, any>();
      for (const h of hist) if (!ultimo.has(h.registro_id)) ultimo.set(h.registro_id, h);
      const nomes = await nomesClientes(u);
      const saida = [];
      for (const h of Array.from(ultimo.values())) {
        const tipo = tipoDaTabela(h.tabela)!;
        const atual = ok(await u.supabase.from(h.tabela).select("*").eq("id", h.registro_id).maybeSingle()) as any;
        saida.push({
          id: h.registro_id, tipo, tipo_rotulo: TIPOS[tipo].rotulo, cliente: nomes.get(h.cliente_id) ?? h.cliente_id,
          ultima_acao: h.acao + (h.desfeito_em ? " (desfeita)" : ""), enviado_em: dataHoraBr(new Date(h.criado_em)),
          situacao: atual ? "existe" : "apagado",
          ...(atual ? infoPrazo(u, tipo, atual) : {}),
          resumo: resumoEnvio(tipo, atual ?? h.dados_antes),
        });
      }
      return { prazo_dias: PRAZO_EDICAO_DIAS, total: saida.length, envios: saida };
    },
  },
  {
    name: "editar_envio",
    title: "Corrigir um envio",
    description:
      `Corrige campos de um registro enviado (FCA, ROI, ponto de equilíbrio, tratativa ou acompanhamento de churn). Só os campos enviados mudam e null limpa o campo. ` +
      `Autor: até ${PRAZO_EDICAO_DIAS} dias após a criação; Coordenador/Gerente: sempre. FCA validado só Coordenador/Gerente (volta para aguardando validação).` + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id do envio (de listar_meus_envios)" },
        tipo: { type: "string", enum: Object.keys(TIPOS), description: "Opcional, acelera a busca" },
        campos: { type: "object", description: "Campos a alterar. Para ROI/ponto de equilíbrio, os campos de dentro de dados (ex.: faturamento)." },
        confirmar: CONFIRMA,
      },
      required: ["id", "campos"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      const { tipo, row } = await carregarEnvio(u, a.id, a.tipo);
      conferirPermissao(u, tipo, row, "editar");
      const campos: Args = { ...(a.campos ?? {}) };
      if (!Object.keys(campos).length) throw new Error("Nada para alterar.");
      if (tipo === "fca") {
        validarNotas(campos);
        if (campos.status === "validado" && !ehGestao(u)) throw new Error("Só Gerente ou Coordenador valida FCA.");
        if (row.status === "validado" && campos.status === undefined) campos.status = "aguardando_validacao";
      }
      if (tipo === "tratativa_churn") await prepararCamposTratativa(u, campos);
      if (tipo === "acompanhamento_churn" && campos.tipo && !TIPOS_ACAO.includes(campos.tipo)) throw new Error(`tipo inválido. Use: ${TIPOS_ACAO.join(", ")}`);
      const patch = montarPatch(tipo, row, campos);
      if (!a.confirmar) {
        return { previa: true, tipo: TIPOS[tipo].rotulo, id: row.id, mudancas: diferenca(tipo, row, { ...row, ...patch }), aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      }
      const { registro, mudancas } = await aplicarEdicao(u, tipo, row, patch);
      return { ok: true, tipo: TIPOS[tipo].rotulo, id: registro.id, mudancas, ...infoPrazo(u, tipo, registro) };
    },
  },
  {
    name: "desfazer_envio",
    title: "Desfazer a última alteração",
    description: "Volta o registro ao estado anterior à SUA última alteração, usando o histórico. Se o registro foi criado nesse envio, ele é apagado; se foi apagado, é recriado. Mesmo prazo e regras de editar_envio." + DUAS_ETAPAS,
    inputSchema: { type: "object", properties: { id: { type: "string" }, confirmar: CONFIRMA }, required: ["id"] },
    annotations: { readOnlyHint: false, destructiveHint: true },
    async run(u, a) {
      if (u.somenteLeitura) throw new Error("Este acesso é somente leitura.");
      return desfazer(u, a.id, !!a.confirmar);
    },
  },
  {
    name: "excluir_envio",
    title: "Excluir envio feito por engano",
    description: `Apaga um registro criado por engano (ex.: no cliente errado). Autor: até ${PRAZO_EDICAO_DIAS} dias; Coordenador/Gerente: sempre. Tratativa de churn só enquanto aberta. Dá para voltar atrás com desfazer_envio.` + DUAS_ETAPAS,
    inputSchema: { type: "object", properties: { id: { type: "string" }, tipo: { type: "string", enum: Object.keys(TIPOS) }, confirmar: CONFIRMA }, required: ["id"] },
    annotations: { readOnlyHint: false, destructiveHint: true },
    async run(u, a) {
      const { tipo, row } = await carregarEnvio(u, a.id, a.tipo);
      conferirPermissao(u, tipo, row, "apagar");
      const nomes = await nomesClientes(u);
      if (!a.confirmar) {
        return { previa: true, vai_apagar: TIPOS[tipo].rotulo, id: row.id, cliente: nomes.get(row.cliente_id), resumo: resumoEnvio(tipo, row), aviso: "Nada foi apagado. Mostre ao usuário e chame de novo com confirmar=true." };
      }
      await apagarRegistro(u, tipo, row);
      return { ok: true, apagado: TIPOS[tipo].rotulo, id: row.id, cliente: nomes.get(row.cliente_id), como_voltar: "desfazer_envio com este id" };
    },
  },

  // ============================================================ CHURN
  {
    name: "ver_tratativas_churn",
    title: "Ver tratativas de churn",
    description: "Tratativas de churn (solicitações de churn/retenção) com id, status, risco, responsável, prazo, ações planejadas e os últimos acompanhamentos. Sem cliente: as abertas da carteira.",
    inputSchema: { type: "object", properties: { cliente: CLIENTE, incluir_encerradas: { type: "boolean" } } },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const nomes = await nomesClientes(u);
      let q = u.supabase.from("ruston_churn_solicitacoes")
        .select("*, responsavel:ruston_pessoas!responsavel_id(nome)")
        .order("data_solicitacao", { ascending: false }).limit(60);
      if (a.cliente) q = q.eq("cliente_id", (await acharCliente(u, a.cliente)).id);
      else q = q.in("cliente_id", Array.from(nomes.keys()));
      if (!a.incluir_encerradas && !a.cliente) q = q.in("status", ABERTOS);
      const sols = ok(await q) as any[];
      const acomp = sols.length
        ? ok(await u.supabase.from("ruston_tratativas_churn").select("*").in("solicitacao_id", sols.map((s) => s.id))
            .order("data_acao", { ascending: false }).order("criado_em", { ascending: false })) as any[]
        : [];
      return sols.map((s) => ({
        id: s.id, cliente: nomes.get(s.cliente_id) ?? s.cliente_id, status: s.status, aberta: ABERTOS.includes(s.status),
        risco: s.risco, responsavel: s.responsavel?.nome ?? null, prazo: s.prazo, aberta_em: s.data_solicitacao,
        mrr: s.mrr, motivo: s.motivo, acoes_planejadas: s.acoes_planejadas, observacoes: s.observacoes,
        encerrada_em: s.encerrado_em, motivo_final: s.motivo_final,
        ultimos_acompanhamentos: acomp.filter((t) => t.solicitacao_id === s.id).slice(0, 3).map((t) => ({
          id: t.id, data: t.data_acao, tipo: t.tipo, o_que_foi_feito: t.descricao, retorno_cliente: t.retorno_cliente,
          resultado: t.resultado, proximo_passo: t.proximo_passo, proximo_passo_data: t.proximo_passo_data, registrado_por: t.registrado_por,
        })),
      }));
    },
  },
  {
    name: "cadastrar_tratativa_churn",
    title: "Abrir tratativa de churn",
    description:
      "Abre uma tratativa de churn (solicitação/retenção) para um cliente: motivo, risco (alto/medio/baixo), responsável, ações planejadas, prazo e observações. " +
      "Se o cliente já tiver uma tratativa aberta, devolve um aviso com o id dela: pergunte ao usuário se é para atualizar a existente (atualizar_tratativa_churn) em vez de abrir outra." + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        motivo: { type: "string" },
        risco: { type: "string", enum: ["alto", "medio", "baixo"] },
        responsavel: { type: "string", description: "Nome ou e-mail da pessoa do time" },
        acoes_planejadas: { type: "string" },
        prazo: { type: "string", description: "AAAA-MM-DD" },
        observacoes: { type: "string" },
        status: { type: "string", enum: ["em_retencao", "solicitado"], description: "solicitado = cliente pediu o cancelamento; em_retencao (padrão) = em risco, time atuando" },
        data_abertura: { type: "string", description: "AAAA-MM-DD. Padrão: hoje" },
        abrir_mesmo_com_aberta: { type: "boolean", description: "true só se o usuário confirmou que quer uma segunda tratativa" },
        confirmar: CONFIRMA,
      },
      required: ["cliente", "motivo"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    papeis: ["gerente", "coordenador"],
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const abertas = ok(await u.supabase.from("ruston_churn_solicitacoes").select("id, status, risco, motivo, data_solicitacao")
        .eq("cliente_id", c.id).in("status", ABERTOS)) as any[];
      if (abertas.length && !a.abrir_mesmo_com_aberta) {
        return { aviso: `${c.nome} já tem tratativa em andamento. Pergunte se é para atualizar a existente (atualizar_tratativa_churn) em vez de abrir outra.`, tratativas_abertas: abertas, nada_gravado: true };
      }
      const resp = a.responsavel ? await acharPessoa(u, a.responsavel) : null;
      const data = a.data_abertura ?? hojeBr();
      const d = new Date(data + "T00:00:00");
      const payload = {
        cliente_id: c.id, data_solicitacao: data, ano: d.getFullYear(), mes: d.getMonth() + 1, mrr: Number(c.mrr) || 0,
        status: a.status ?? "em_retencao", motivo: a.motivo, risco: a.risco ?? null, responsavel_id: resp?.id ?? null,
        acoes_planejadas: a.acoes_planejadas ?? null, prazo: a.prazo ?? null, observacoes: a.observacoes ?? null,
      };
      if (!a.confirmar) return { previa: true, cliente: c.nome, responsavel: resp?.nome ?? null, vai_gravar: payload, aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      const novo = await criarRegistro(u, "tratativa_churn", payload);
      return { ok: true, id: novo.id, cliente: c.nome, status: novo.status, responsavel: resp?.nome ?? null };
    },
  },
  {
    name: "atualizar_tratativa_churn",
    title: "Atualizar tratativa de churn",
    description:
      "Edita uma tratativa aberta: status (solicitado/em_retencao), risco, responsável, motivo, ações planejadas, prazo, observações. Só os campos enviados mudam e null limpa. " +
      "Responsável, Coordenador e Gerente podem atualizar a qualquer momento enquanto ela estiver aberta. Para fechar use encerrar_tratativa_churn." + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da tratativa (ver_tratativas_churn)" },
        status: { type: "string", enum: ["solicitado", "em_retencao"] },
        risco: { type: ["string", "null"], enum: ["alto", "medio", "baixo", null] },
        responsavel: { type: ["string", "null"], description: "Nome/e-mail; null tira o responsável" },
        motivo: TEXTO_OU_NULL, acoes_planejadas: TEXTO_OU_NULL, observacoes: TEXTO_OU_NULL,
        prazo: { type: ["string", "null"], description: "AAAA-MM-DD" },
        confirmar: CONFIRMA,
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      const { row } = await carregarEnvio(u, a.id, "tratativa_churn");
      conferirPermissao(u, "tratativa_churn", row, "editar");
      const campos: Args = {};
      for (const k of ["status", "risco", "motivo", "acoes_planejadas", "observacoes", "prazo", "responsavel"]) if (a[k] !== undefined) campos[k] = a[k];
      if (!Object.keys(campos).length) throw new Error("Nada para alterar.");
      await prepararCamposTratativa(u, campos);
      if (!a.confirmar) return { previa: true, id: row.id, mudancas: diferenca("tratativa_churn", row, { ...row, ...campos }), aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      const { registro, mudancas } = await aplicarEdicao(u, "tratativa_churn", row, campos);
      return { ok: true, id: registro.id, status: registro.status, mudancas };
    },
  },
  {
    name: "registrar_acompanhamento_churn",
    title: "Registrar acompanhamento de churn",
    description:
      "Adiciona um acompanhamento datado a uma tratativa aberta (o que foi feito, retorno do cliente, próximo passo), sem mexer nos anteriores. Aparece na linha do tempo do Radar de Churn. " +
      `tipo: ${TIPOS_ACAO.join(", ")}. resultado: em_andamento (padrão), resolvido, sem_efeito.` + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        tratativa_id: { type: "string" },
        o_que_foi_feito: { type: "string" },
        tipo: { type: "string", enum: TIPOS_ACAO },
        retorno_cliente: { type: "string" },
        proximo_passo: { type: "string" },
        proximo_passo_data: { type: "string", description: "AAAA-MM-DD" },
        resultado: { type: "string", enum: ["em_andamento", "resolvido", "sem_efeito"] },
        data: { type: "string", description: "AAAA-MM-DD. Padrão: hoje" },
        link_drive: { type: "string" }, link_task: { type: "string" },
        confirmar: CONFIRMA,
      },
      required: ["tratativa_id", "o_que_foi_feito", "tipo"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      if (u.somenteLeitura) throw new Error("Este acesso é somente leitura.");
      const { row: sol } = await carregarEnvio(u, a.tratativa_id, "tratativa_churn");
      if (!ABERTOS.includes(sol.status)) throw new Error("Tratativa encerrada. Para registrar, um Coordenador/Gerente precisa reabrir.");
      if (!ehGestao(u) && !(u.pessoaId && sol.responsavel_id === u.pessoaId)) throw new Error("Só o responsável pela tratativa, o Coordenador ou o Gerente registram acompanhamentos.");
      const payload = {
        cliente_id: sol.cliente_id, solicitacao_id: sol.id, data_acao: a.data ?? hojeBr(), tipo: a.tipo, descricao: a.o_que_foi_feito,
        retorno_cliente: a.retorno_cliente ?? null, proximo_passo: a.proximo_passo ?? null, proximo_passo_data: a.proximo_passo_data ?? null,
        resultado: a.resultado ?? "em_andamento", link_drive: a.link_drive ?? null, link_task: a.link_task ?? null,
      };
      if (!a.confirmar) return { previa: true, vai_gravar: payload, aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      const novo = await criarRegistro(u, "acompanhamento_churn", payload);
      return { ok: true, id: novo.id, tratativa_id: sol.id, ...infoPrazo(u, "acompanhamento_churn", novo) };
    },
  },
  {
    name: "encerrar_tratativa_churn",
    title: "Encerrar tratativa de churn",
    description:
      "Fecha a tratativa com o resultado: revertido (cliente retido) ou churn_confirmado, mais o motivo final e a data. " +
      "Churn confirmado segue a regra do sistema: o cliente fica inativo, marcado como churn realizado e vai para a etapa Cancelado. " +
      "Revertido: se o cliente estava inativo/em retenção, volta para a etapa anterior. A prévia mostra esses efeitos." + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        resultado: { type: "string", enum: ["revertido", "churn_confirmado"] },
        motivo_final: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD. Padrão: hoje" },
        confirmar: CONFIRMA,
      },
      required: ["id", "resultado", "motivo_final"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    papeis: ["gerente", "coordenador"],
    async run(u, a) {
      if (u.somenteLeitura) throw new Error("Este acesso é somente leitura.");
      const { row } = await carregarEnvio(u, a.id, "tratativa_churn");
      if (!ABERTOS.includes(row.status)) throw new Error(`Esta tratativa já está encerrada (${row.status}).`);
      const cli = ok(await u.supabase.from("ruston_clientes").select("*").eq("id", row.cliente_id).single()) as any;
      const data = a.data ?? hojeBr();
      const confirmado = a.resultado === "churn_confirmado";
      const patch = { status: confirmado ? "confirmado" : "revertido", motivo_final: a.motivo_final, encerrado_em: data, encerrado_por: u.email };
      const efeitos = confirmado
        ? { cliente: cli.nome, fica: "INATIVO, churn realizado, etapa Cancelado", data_churn: data, motivo_churn: a.motivo_final, mrr_perdido: row.mrr }
        : { cliente: cli.nome, fica: cli.ativo && !["em_recuperacao", "cancelado"].includes(cli.etapa) ? "sem mudança no cadastro (segue ativo)" : `reativado, volta para ${cli.etapa_anterior ?? "byline"}` };
      if (!a.confirmar) return { previa: true, tratativa: { id: row.id, ...diferenca("tratativa_churn", row, { ...row, ...patch }) }, efeitos_no_cliente: efeitos, aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };

      if (confirmado) {
        const novoCli = ok(await u.supabase.from("ruston_clientes").update({
          churn_realizado: true, ativo: false, data_churn: data, motivo_churn: a.motivo_final, etapa: "cancelado",
        }).eq("id", cli.id).select("*").single());
        await registrarHistorico(u, "ruston_clientes", "editar", cli, novoCli);
      }
      const { registro } = await aplicarEdicao(u, "tratativa_churn", row, patch);
      const depois = ok(await u.supabase.from("ruston_clientes").select("nome, ativo, churn_realizado, etapa").eq("id", cli.id).single());
      return { ok: true, id: registro.id, status: registro.status, cliente_agora: depois };
    },
  },
  {
    name: "reabrir_tratativa_churn",
    title: "Reabrir tratativa de churn",
    description: "Reabre uma tratativa encerrada como revertida (volta para em_retencao). Só Coordenador/Gerente. Churn confirmado não reabre por aqui: reative o cliente pelo sistema." + DUAS_ETAPAS,
    inputSchema: { type: "object", properties: { id: { type: "string" }, motivo: { type: "string" }, confirmar: CONFIRMA }, required: ["id"] },
    annotations: { readOnlyHint: false, destructiveHint: false },
    papeis: ["gerente", "coordenador"],
    async run(u, a) {
      if (u.somenteLeitura) throw new Error("Este acesso é somente leitura.");
      const { row } = await carregarEnvio(u, a.id, "tratativa_churn");
      if (ABERTOS.includes(row.status)) throw new Error("Esta tratativa já está aberta.");
      if (row.status === "confirmado") throw new Error("Churn confirmado não reabre pelo MCP. Reative o cliente pelo sistema (Churn > Reativar).");
      const obs = a.motivo ? `${row.observacoes ? row.observacoes + "\n" : ""}Reaberta em ${hojeBr()}: ${a.motivo}` : row.observacoes;
      const patch = { status: "em_retencao", encerrado_em: null, encerrado_por: null, motivo_final: null, observacoes: obs };
      if (!a.confirmar) return { previa: true, id: row.id, mudancas: diferenca("tratativa_churn", row, { ...row, ...patch }), aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      const { registro, mudancas } = await aplicarEdicao(u, "tratativa_churn", row, patch);
      return { ok: true, id: registro.id, status: registro.status, mudancas };
    },
  },

  // ============================================================ METAS DOS CLIENTES
  {
    name: "ver_metas_clientes",
    title: "Ver metas dos clientes",
    description:
      "Metas do mês por cliente (tela 🎯 Metas dos Clientes): meta de leads e de faturamento, o lançamento de cada semana (sábado a sexta, fechada dentro do mês: a primeira começa no dia 01 e a última termina no fim do mês; prazo na segunda seguinte), " +
      "o realizado do mês (soma das semanas, ou o total corrigido), % da meta, ritmo (realizado x esperado pelas semanas que já passaram do prazo) e a situação " +
      "(sem_meta, meta_incompleta, semana_pendente, em_andamento, sem_resultado, completo). Traz as pendências por GP, para cobrar o time. " +
      "Sem ano/mês usa o mês atual. Filtros opcionais: cliente, gp (nome do GP/Account), so_pendentes.",
    inputSchema: {
      type: "object",
      properties: {
        ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 },
        cliente: CLIENTE,
        gp: { type: "string", description: "Nome (ou parte) do GP/Account; 'sem' = clientes sem GP" },
        so_pendentes: { type: "boolean", default: false },
      },
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { ano, mes } = anoMesPadrao(a);
      const hoje = hojeIsoBr();
      const [cs, mt, sm] = await Promise.all([
        clientesDasMetas(u),
        u.supabase.from("ruston_cliente_metas_mensal").select("*").eq("ano", ano).eq("mes", mes),
        u.supabase.from("ruston_cliente_metas_semanal").select("*").eq("ano", ano).eq("mes", mes),
      ]);
      const metas = new Map((ok(mt) as MetaMensal[]).map((m) => [m.cliente_id, m]));
      const semanas = ok(sm) as MetaSemanal[];
      let linhas = cs.map((c) => linhaMeta(c, metas.get(c.id), semanas.filter((s) => s.cliente_id === c.id), ano, mes, hoje));
      const porGP = new Map<string, { gp: string; total: number; pendentes: number; semanas_sem_lancar: number; clientes_pendentes: string[] }>();
      for (const l of linhas) {
        const it = porGP.get(l.gp) ?? { gp: l.gp, total: 0, pendentes: 0, semanas_sem_lancar: 0, clientes_pendentes: [] as string[] };
        it.total++;
        it.semanas_sem_lancar += l.semanas_sem_lancar.length;
        if (l.pendente) { it.pendentes++; it.clientes_pendentes.push(l.cliente); }
        porGP.set(l.gp, it);
      }
      if (a.cliente) { const c = await acharCliente(u, a.cliente); linhas = linhas.filter((l) => l.id === c.id); }
      if (a.gp) {
        const n = normalizar(a.gp);
        linhas = linhas.filter((l) => (n === "sem" ? l.gp === "Sem GP" : normalizar(l.gp).includes(n)));
      }
      if (a.so_pendentes) linhas = linhas.filter((l) => l.pendente);
      const semanasMes = semanasDoMes(ano, mes);
      return {
        mes: `${String(mes).padStart(2, "0")}/${ano}`,
        mes_fechado: mesFechadoEm(ano, mes, hoje),
        semanas_do_mes: semanasMes.map((s, i) => ({ semana: i + 1, ultimo_dia: s, periodo: rotuloSemana(s), prazo: diaMes(prazoDaSemana(s)), cobrada: semanaCobrada(s, hoje) })),
        total_clientes: linhas.length,
        pendentes: linhas.filter((l) => l.pendente).length,
        pendencias_por_gp: Array.from(porGP.values()).sort((x, y) => y.pendentes - x.pendentes || x.gp.localeCompare(y.gp)),
        clientes: linhas.map(({ id, ...resto }) => resto),
      };
    },
  },
  {
    name: "lancar_semana_cliente",
    title: "Lançar a semana do cliente",
    description:
      "Lança os leads e o faturamento de UMA semana do cliente (sábado a sexta, fechada dentro do mês: a primeira começa no dia 01 e a última termina no fim do mês; prazo até a segunda seguinte). " +
      "Informe a data (qualquer dia da semana; sem data = a última semana que já terminou). " +
      "Só os campos enviados mudam (null limpa)." + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        data: { type: "string", description: "YYYY-MM-DD de qualquer dia da semana" },
        leads: { type: ["integer", "null"] },
        faturamento: { type: ["number", "null"] },
        observacoes: TEXTO_OU_NULL,
        confirmar: CONFIRMA,
      },
      required: ["cliente"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      const hoje = hojeIsoBr();
      if (a.data && !/^\d{4}-\d{2}-\d{2}$/.test(a.data)) throw new Error("data no formato YYYY-MM-DD.");
      // Sem data: a última semana que já terminou
      const sexta = a.data ? fimDaSemana(a.data) : (() => { const s = fimDaSemana(hoje); return s > hoje ? semanaAnterior(s) : s; })();
      if (sexta > fimDaSemana(hoje)) throw new Error("Essa semana ainda não começou.");
      const ano = Number(sexta.slice(0, 4)), mes = Number(sexta.slice(5, 7));
      const c = await acharCliente(u, a.cliente);
      const campos: Args = {};
      for (const k of ["leads", "faturamento", "observacoes"]) {
        if (a[k] === undefined) continue;
        const v = a[k];
        if (k !== "observacoes" && v !== null && (typeof v !== "number" || !isFinite(v) || v < 0)) throw new Error(`${k} precisa ser um número maior ou igual a zero.`);
        campos[k] = k === "leads" && v !== null ? Math.round(v) : v;
      }
      if (!Object.keys(campos).length) throw new Error("Nada para gravar. Campos: leads, faturamento, observacoes.");
      const atual = ok(await u.supabase.from("ruston_cliente_metas_semanal").select("*")
        .eq("cliente_id", c.id).eq("data_referencia", sexta).maybeSingle()) as any;
      const mudancas = Object.keys(campos)
        .filter((k) => (atual?.[k] != null && k !== "observacoes" ? Number(atual[k]) : atual?.[k] ?? null) !== campos[k])
        .map((k) => ({ campo: k, antes: atual?.[k] ?? null, depois: campos[k] }));
      const semanaTxt = rotuloSemana(sexta);
      if (!mudancas.length) return { ok: true, acao: "sem mudança", cliente: c.nome, semana: semanaTxt };
      if (!a.confirmar) {
        return { previa: true, cliente: c.nome, semana: semanaTxt, acao: atual ? "atualizar" : "criar", mudancas, aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      }
      ok(await u.supabase.from("ruston_cliente_metas_semanal")
        .upsert({ cliente_id: c.id, data_referencia: sexta, ano, mes, ...campos, atualizado_por: u.email, updated_at: new Date().toISOString() }, { onConflict: "cliente_id,data_referencia" })
        .select().single());
      const [mt, sm] = await Promise.all([
        u.supabase.from("ruston_cliente_metas_mensal").select("*").eq("cliente_id", c.id).eq("ano", ano).eq("mes", mes).maybeSingle(),
        u.supabase.from("ruston_cliente_metas_semanal").select("*").eq("cliente_id", c.id).eq("ano", ano).eq("mes", mes),
      ]);
      const l = linhaMeta(c, ok(mt) as MetaMensal | null, ok(sm) as MetaSemanal[], ano, mes, hoje);
      return {
        ok: true, acao: atual ? "atualizado" : "criado", cliente: c.nome, semana: semanaTxt, mudancas,
        mes_ate_agora: { leads: l.leads, faturamento: l.faturamento, situacao: l.situacao, semanas_sem_lancar: l.semanas_sem_lancar },
      };
    },
  },
  {
    name: "salvar_meta_cliente",
    title: "Preencher meta do mês / corrigir o total",
    description:
      "Preenche a meta do mês do cliente: meta_leads (inteiro) e meta_faturamento (R$), e observacoes. " +
      "resultado_leads e resultado_faturamento são opcionais: o resultado do mês já é a soma das semanas (lancar_semana_cliente); só preencha para CORRIGIR o total quando o número fechado do cliente for diferente (null volta a usar a soma). " +
      "Só os campos enviados mudam. Sem ano/mês usa o mês atual." + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 },
        meta_leads: { type: ["integer", "null"] }, meta_faturamento: { type: ["number", "null"] },
        resultado_leads: { type: ["integer", "null"] }, resultado_faturamento: { type: ["number", "null"] },
        observacoes: TEXTO_OU_NULL,
        confirmar: CONFIRMA,
      },
      required: ["cliente"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      const { ano, mes } = anoMesPadrao(a);
      const c = await acharCliente(u, a.cliente);
      const campos: Args = {};
      for (const k of CAMPOS_META) {
        if (a[k] === undefined) continue;
        const v = a[k];
        if (k !== "observacoes" && v !== null && (typeof v !== "number" || !isFinite(v) || v < 0)) throw new Error(`${k} precisa ser um número maior ou igual a zero.`);
        campos[k] = k.endsWith("_leads") && v !== null ? Math.round(v) : v;
      }
      if (!Object.keys(campos).length) throw new Error(`Nada para gravar. Campos: ${CAMPOS_META.join(", ")}.`);
      const atual = ok(await u.supabase.from("ruston_cliente_metas_mensal").select("*")
        .eq("cliente_id", c.id).eq("ano", ano).eq("mes", mes).maybeSingle()) as any;
      const mudancas = Object.keys(campos)
        .filter((k) => (atual?.[k] != null && k !== "observacoes" ? Number(atual[k]) : atual?.[k] ?? null) !== campos[k])
        .map((k) => ({ campo: k, antes: atual?.[k] ?? null, depois: campos[k] }));
      const mesTxt = `${String(mes).padStart(2, "0")}/${ano}`;
      if (!mudancas.length) return { ok: true, acao: "sem mudança", cliente: c.nome, mes: mesTxt };
      if (!a.confirmar) {
        return { previa: true, cliente: c.nome, mes: mesTxt, acao: atual ? "atualizar" : "criar", mudancas, aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      }
      const gravado = ok(await u.supabase.from("ruston_cliente_metas_mensal")
        .upsert({ cliente_id: c.id, ano, mes, ...campos, atualizado_por: u.email, updated_at: new Date().toISOString() }, { onConflict: "cliente_id,ano,mes" })
        .select().single()) as MetaMensal;
      const sm = ok(await u.supabase.from("ruston_cliente_metas_semanal").select("*").eq("cliente_id", c.id).eq("ano", ano).eq("mes", mes)) as MetaSemanal[];
      const l = linhaMeta(c, gravado, sm, ano, mes, hojeIsoBr());
      return { ok: true, acao: atual ? "atualizado" : "criado", cliente: c.nome, mes: mesTxt, mudancas, leads: l.leads, faturamento: l.faturamento, situacao: l.situacao };
    },
  },

  // ============================================================ PESQUISAS
  {
    name: "consultar_pesquisas",
    title: "Consultar pesquisas",
    description: "Pesquisas de satisfação enviadas aos clientes (pós-planejamento, pós-check-in, EE) com nota (0 a 5) e respostas. Sem cliente: as últimas respondidas da carteira.",
    inputSchema: {
      type: "object",
      properties: { cliente: CLIENTE, so_respondidas: { type: "boolean", default: true }, limite: { type: "integer", default: 20 } },
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const nomes = await nomesClientes(u);
      let q = u.supabase.from("ruston_pesquisas").select("*").eq("cancelada", false)
        .order("criada_em", { ascending: false }).limit(Math.min(a.limite ?? 20, 100));
      if (a.cliente) q = q.eq("cliente_id", (await acharCliente(u, a.cliente)).id);
      else q = q.in("cliente_id", Array.from(nomes.keys()));
      if (a.so_respondidas !== false) q = q.not("respondida_em", "is", null);
      const rows = ok(await q) as Pesquisa[];
      return rows.map((p) => {
        const f = formularioDe(p.tipo, p.semana_ee);
        const respostas = p.respostas
          ? f.perguntas.filter((q) => perguntaVisivel(q, p.respostas!) && p.respostas![q.id] != null)
              .map((q) => ({ pergunta: q.texto, resposta: p.respostas![q.id] }))
          : null;
        return {
          cliente: nomes.get(p.cliente_id) ?? p.cliente_id, pesquisa: nomePesquisa(p.tipo, p.semana_ee),
          enviada_por: p.enviada_por, criada_em: p.criada_em, respondida_em: p.respondida_em, nota: p.nota, respostas,
        };
      });
    },
  },
  // ============================================================ PERMISSÕES
  {
    name: "minhas_permissoes",
    title: "Minhas permissões",
    description: "Mostra quem é o usuário conectado, o perfil (gerente, coordenador ou gestor), o escopo (squad ou unidade inteira) e o que ele pode consultar e gravar pelo MCP.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    async run(u) {
      const lista = ferramentasDo(u);
      let squad: string | null = null;
      if (u.squadId) squad = ((ok(await u.supabase.from("ruston_squads").select("nome").eq("id", u.squadId).maybeSingle()) as any)?.nome) ?? u.squadId;
      const rotuloPapel = { gerente: "Gerente", coordenador: "Coordenador", gestor: "Gestor de Projetos" }[u.papel];
      return {
        usuario: u.email,
        perfil: rotuloPapel,
        escopo: u.squadId ? `só o squad ${squad}` : "unidade inteira (todos os squads)",
        somente_leitura: u.somenteLeitura,
        pode_consultar: lista.filter((f) => f.annotations.readOnlyHint).map((f) => `${f.name}: ${f.title}`),
        pode_gravar: lista.filter((f) => !f.annotations.readOnlyHint).map((f) => `${f.name}: ${f.title}`),
        regras: [
          "Toda gravação mostra uma prévia (antes/depois) e só grava depois do OK (confirmar=true).",
          ehGestao(u)
            ? "Coordenador/Gerente podem corrigir envios sem prazo e validar FCA."
            : `Você pode corrigir o que enviou em até ${PRAZO_EDICAO_DIAS} dias. FCA validado só Coordenador/Gerente altera.`,
          "Remuneração das pessoas nunca aparece pelo MCP.",
        ],
      };
    },
  },

  // ============================================================ EQUIPE
  {
    name: "ver_equipe",
    title: "Ver equipe",
    description: "Colaboradores ativos (do seu squad, para coordenador e gestor; da unidade, para o gerente) com cargo, squad, coordenador do squad, carteira (nº de clientes como GP, tráfego e designer) e MRR sob responsabilidade como GP. Não mostra remuneração. Filtros: squad, cargo, nome.",
    inputSchema: {
      type: "object",
      properties: {
        squad: { type: "string" }, cargo: { type: "string", description: "ex.: gestor_projetos, gestor_trafego, designer, coordenador" },
        nome: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      let qc = u.supabase.from("ruston_clientes_view").select("id, mrr, squad_id, account_id, gestor_trafego_id, designer_id").eq("ativo", true);
      if (u.squadId) qc = qc.eq("squad_id", u.squadId);
      const [ps, sq, cs] = await Promise.all([
        u.supabase.from("ruston_pessoas").select("id, nome, email, cargo, squad_id, nivel_senioridade, nivel_v, compartilhado_entre_squads").eq("ativo", true).order("nome"),
        u.supabase.from("ruston_squads").select("id, nome, coordenador_id").eq("ativo", true),
        qc,
      ]);
      const squads = ok(sq) as any[];
      const nomeSquad = new Map(squads.map((s) => [s.id, s.nome as string]));
      const clientes = ok(cs) as any[];
      let pessoas = ok(ps) as any[];
      const nomePessoa = new Map(pessoas.map((p) => [p.id, p.nome as string]));
      if (u.squadId) pessoas = pessoas.filter((p) => p.squad_id === u.squadId || p.compartilhado_entre_squads || clientes.some((c) => [c.account_id, c.gestor_trafego_id, c.designer_id].includes(p.id)));
      if (a.squad) pessoas = pessoas.filter((p) => normalizar(nomeSquad.get(p.squad_id) ?? "").includes(normalizar(a.squad)));
      if (a.cargo) pessoas = pessoas.filter((p) => normalizar(p.cargo ?? "").includes(normalizar(a.cargo)));
      if (a.nome) pessoas = pessoas.filter((p) => normalizar(p.nome).includes(normalizar(a.nome)));
      return {
        total: pessoas.length,
        pessoas: pessoas.map((p) => {
          const comoGp = clientes.filter((c) => c.account_id === p.id);
          const coordId = squads.find((s) => s.id === p.squad_id)?.coordenador_id ?? null;
          return {
            nome: p.nome, email: p.email, cargo: p.cargo, squad: nomeSquad.get(p.squad_id) ?? null,
            coordenador_do_squad: coordId && coordId !== p.id ? nomePessoa.get(coordId) ?? null : null,
            senioridade: p.nivel_senioridade, nivel_v: p.nivel_v, compartilhado_entre_squads: p.compartilhado_entre_squads,
            carteira: {
              como_gp: comoGp.length,
              como_trafego: clientes.filter((c) => c.gestor_trafego_id === p.id).length,
              como_designer: clientes.filter((c) => c.designer_id === p.id).length,
              mrr_como_gp: comoGp.reduce((s, c) => s + (Number(c.mrr) || 0), 0),
            },
          };
        }),
      };
    },
  },

  // ============================================================ VISÃO MACRO
  {
    name: "visao_macro",
    title: "Visão macro (squad ou unidade)",
    description: "Resumo consolidado do mês no seu escopo (coordenador/gestor: o squad; gerente: a unidade): MRR total, clientes ativos por etapa, churn do mês (clientes e MRR), tratativas de churn abertas por risco, bandeiras do último FCA, nota média das pesquisas respondidas no mês, monetização ganha no mês e metas x realizado. Com quebra por squad e por GP. Sem ano/mês usa o mês atual.",
    inputSchema: { type: "object", properties: { ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 } } },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { ano, mes } = anoMesPadrao(a);
      const ini = `${ano}-${String(mes).padStart(2, "0")}-01`;
      const fim = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
      const avisos: string[] = [];
      async function talvez(rotulo: string, p: PromiseLike<{ data: any; error: any }> | null): Promise<any[] | null> {
        if (!p) return null;
        const r = await p;
        if (r.error) { avisos.push(`${rotulo}: ${r.error.message}`); return null; }
        return r.data as any[];
      }
      let qc = u.supabase.from("ruston_clientes_view").select("id, nome, etapa, mrr, ativo, churn_realizado, data_churn, squad_id, squad_nome, account_nome");
      if (u.squadId) qc = qc.eq("squad_id", u.squadId);
      const todos = ok(await qc) as any[];
      const ativos = todos.filter((c) => c.ativo);
      const ids = todos.map((c) => c.id);
      const churnMes = todos.filter((c) => c.churn_realizado && c.data_churn && c.data_churn >= ini && c.data_churn <= fim);

      let qMon = u.supabase.from("ruston_monetizacao_view").select("cliente_squad_id, estagio, valor_mrr_estimado, valor_onetime_estimado, data_ganho, ativo").eq("ativo", true);
      if (u.squadId) qMon = qMon.eq("cliente_squad_id", u.squadId);
      let qMs = u.supabase.from("ruston_metas_squad").select("*").eq("ano", ano).eq("mes", mes).order("ordem");
      if (u.squadId) qMs = qMs.eq("squad_id", u.squadId);

      const [trat, fcas, pesq, mon, mSquad, mEmp, sqs] = await Promise.all([
        talvez("tratativas", u.supabase.from("ruston_churn_solicitacoes").select("cliente_id, risco, status").in("status", ABERTOS).in("cliente_id", ids)),
        talvez("fca", u.supabase.from("ruston_fca_view").select("*").in("cliente_id", ativos.map((c) => c.id)).order("data_referencia", { ascending: false }).limit(3000)),
        talvez("pesquisas", u.supabase.from("ruston_pesquisas").select("cliente_id, nota, respondida_em").eq("cancelada", false).gte("respondida_em", ini).lte("respondida_em", fim + "T23:59:59").in("cliente_id", ids)),
        talvez("monetização", qMon),
        talvez("metas do squad", qMs),
        talvez("metas da unidade", u.supabase.from("ruston_metas_empresa").select("*").eq("ano", ano).eq("mes", mes).order("ordem")),
        talvez("squads", u.supabase.from("ruston_squads").select("id, nome")),
      ]);
      const nomeSquad = new Map((sqs ?? []).map((s: any) => [s.id, s.nome]));

      const ultimoFca = new Map<string, any>();
      for (const f of fcas ?? []) if (!ultimoFca.has(f.cliente_id)) ultimoFca.set(f.cliente_id, f);
      const bandeiraDe = (id: string): string => {
        const f = ultimoFca.get(id);
        if (!f) return "sem_dado";
        return f.bandeira ?? bandeiraDaNota(f.nota_final ?? calcularNotaFinalFca(f));
      };
      const tratAbertas = trat ?? [];
      const notas = (pesq ?? []).filter((p) => p.nota != null).map((p) => Number(p.nota));
      const ganhas = (mon ?? []).filter((o) => o.data_ganho && o.data_ganho >= ini && o.data_ganho <= fim);

      const agrupa = (chave: (c: any) => string) => {
        const m = new Map<string, any>();
        for (const c of ativos) {
          const k = chave(c);
          const it = m.get(k) ?? { nome: k, clientes: 0, mrr: 0, fca_vermelho: 0, fca_amarelo: 0, fca_sem_dado: 0, tratativas_abertas: 0 };
          it.clientes++; it.mrr += Number(c.mrr) || 0;
          const b = bandeiraDe(c.id);
          if (b === "vermelho") it.fca_vermelho++; else if (b === "amarelo") it.fca_amarelo++; else if (b === "sem_dado") it.fca_sem_dado++;
          it.tratativas_abertas += tratAbertas.filter((t) => t.cliente_id === c.id).length;
          m.set(k, it);
        }
        return Array.from(m.values()).sort((x, y) => y.mrr - x.mrr);
      };
      const contaEtapa: Record<string, number> = {};
      for (const c of ativos) { const e = ETAPA_LABEL[c.etapa as keyof typeof ETAPA_LABEL] ?? c.etapa; contaEtapa[e] = (contaEtapa[e] ?? 0) + 1; }
      const bandeiras: Record<string, number> = { verde: 0, amarelo: 0, vermelho: 0, sem_dado: 0 };
      for (const c of ativos) { const b = bandeiraDe(c.id); bandeiras[b] = (bandeiras[b] ?? 0) + 1; }
      const metaFmt = (m: any) => ({ metrica: m.metrica_label ?? m.metrica, unidade: m.unidade, meta: m.valor_meta, realizado: m.valor_realizado, observacoes: m.observacoes });

      return {
        mes: `${String(mes).padStart(2, "0")}/${ano}`,
        escopo: u.squadId ? "seu squad" : "unidade inteira",
        mrr_total: ativos.reduce((s, c) => s + (Number(c.mrr) || 0), 0),
        clientes_ativos: ativos.length,
        clientes_por_etapa: contaEtapa,
        churn_do_mes: { clientes: churnMes.length, mrr: churnMes.reduce((s, c) => s + (Number(c.mrr) || 0), 0), quais: churnMes.map((c) => c.nome) },
        tratativas_abertas: {
          total: tratAbertas.length,
          risco_alto: tratAbertas.filter((t) => t.risco === "alto").length,
          risco_medio: tratAbertas.filter((t) => t.risco === "medio").length,
          risco_baixo: tratAbertas.filter((t) => t.risco === "baixo").length,
        },
        fca_ultima_bandeira: bandeiras,
        pesquisas_do_mes: { respondidas: notas.length, nota_media_0a5: notas.length ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10 : null },
        monetizacao_ganha_no_mes: {
          quantidade: ganhas.length,
          mrr: ganhas.reduce((s, o) => s + (Number(o.valor_mrr_estimado) || 0), 0),
          one_time: ganhas.reduce((s, o) => s + (Number(o.valor_onetime_estimado) || 0), 0),
        },
        metas_unidade: (mEmp ?? []).map(metaFmt),
        metas_squad: (mSquad ?? []).map((m) => ({ squad: nomeSquad.get(m.squad_id) ?? m.squad_id, ...metaFmt(m) })),
        por_squad: u.squadId ? undefined : agrupa((c) => c.squad_nome ?? "Sem squad"),
        por_gp: agrupa((c) => c.account_nome ?? "Sem GP"),
        avisos: avisos.length ? avisos : undefined,
      };
    },
  },

  // ============================================================ ENTREGÁVEIS
  {
    name: "ver_entregaveis",
    title: "Ver entregáveis previstos",
    description: "Entregáveis previstos por cliente (tipo de entrega, categoria, quantidade mensal, % de alocação e valor). Sem cliente: todos do seu escopo, com filtro opcional por categoria (recorrente, pontual_saber, pontual_ter, componente).",
    inputSchema: { type: "object", properties: { cliente: CLIENTE, categoria: { type: "string", enum: ["recorrente", "pontual_saber", "pontual_ter", "componente"] } } },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      let q = u.supabase.from("ruston_entregas_view").select("*").eq("ativo", true).order("cliente_nome");
      if (a.cliente) q = q.eq("cliente_id", (await acharCliente(u, a.cliente)).id);
      else if (u.squadId) q = q.eq("cliente_squad_id", u.squadId);
      if (a.categoria) q = q.eq("tipo_entrega_categoria", a.categoria);
      const rows = ok(await q) as any[];
      return {
        total: rows.length,
        entregaveis: rows.map((e) => ({
          cliente: e.cliente_nome, entrega: e.tipo_entrega_nome, categoria: e.tipo_entrega_categoria,
          quantidade_mensal: e.quantidade_mensal, quantidade_texto: e.quantidade_texto, unidade: e.unidade_padrao,
          alocacao_pct: e.percentual_alocacao, valor_mensal: e.valor_mensal, observacoes: e.observacoes,
        })),
      };
    },
  },

  // ============================================================ MONETIZAÇÃO
  {
    name: "ver_monetizacao",
    title: "Ver monetização (upsell)",
    description: "Oportunidades de monetização (upsell) da carteira: cliente, título, estágio, MRR e one-time estimados, probabilidade, previsão de fechamento, ganho/perda e dias parado. Traz também a meta de monetização do mês por squad. Filtros: cliente, estagio, incluir_inativas.",
    inputSchema: {
      type: "object",
      properties: { cliente: CLIENTE, estagio: { type: "string" }, incluir_inativas: { type: "boolean" }, ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 } },
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { ano, mes } = anoMesPadrao(a);
      let q = u.supabase.from("ruston_monetizacao_view").select("*").order("updated_at", { ascending: false }).limit(300);
      if (!a.incluir_inativas) q = q.eq("ativo", true);
      if (a.cliente) q = q.eq("cliente_id", (await acharCliente(u, a.cliente)).id);
      else if (u.squadId) q = q.eq("cliente_squad_id", u.squadId);
      if (a.estagio) q = q.eq("estagio", a.estagio);
      let qm = u.supabase.from("ruston_monetizacao_metas").select("squad_id, ano, mes, valor_meta").eq("ano", ano).eq("mes", mes);
      if (u.squadId) qm = qm.eq("squad_id", u.squadId);
      const [ops, metas, sq] = await Promise.all([q, qm, u.supabase.from("ruston_squads").select("id, nome")]);
      const nomeSquad = new Map((ok(sq) as any[]).map((s) => [s.id, s.nome]));
      const rows = ok(ops) as any[];
      return {
        metas_do_mes: (ok(metas) as any[]).map((m) => ({ squad: nomeSquad.get(m.squad_id) ?? m.squad_id, meta: m.valor_meta })),
        total: rows.length,
        oportunidades: rows.map((o) => ({
          id: o.id, cliente: o.cliente_nome, squad: o.squad_nome, gp: o.gp_nome, responsavel: o.responsavel_nome,
          titulo: o.titulo, descricao: o.descricao, estagio: o.estagio, mrr_estimado: o.valor_mrr_estimado, one_time_estimado: o.valor_onetime_estimado,
          probabilidade: o.probabilidade, previsao_fechamento: o.data_prevista_fechamento, ganho_em: o.data_ganho, perdido_em: o.data_perda,
          motivo_perda: o.motivo_perda, aplicado_no_mrr: o.aplicado_no_mrr, dias_parado: o.dias_parado, ativo: o.ativo,
        })),
      };
    },
  },

  // ============================================================ FORECAST
  {
    name: "ver_forecast",
    title: "Ver forecast da unidade",
    description: "Forecast mensal da unidade: meta de MRR, aquisição e upsell (MRR e one-time) projetados x realizados, churn projetado x realizado, MRR realizado e fechamento do mês. Sem mês: os 12 meses do ano.",
    inputSchema: { type: "object", properties: { ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 } } },
    annotations: { readOnlyHint: true },
    papeis: ["gerente", "coordenador"],
    async run(u, a) {
      const ano = a.ano ?? Number(hojeIsoBr().slice(0, 4));
      let q = u.supabase.from("ruston_forecast").select("*").eq("ano", ano).order("mes");
      if (a.mes) q = q.eq("mes", a.mes);
      const rows = ok(await q) as any[];
      return rows.map((f) => ({
        mes: `${String(f.mes).padStart(2, "0")}/${f.ano}`, meta_mrr: f.meta_mrr, mrr_realizado: f.mrr_realizado,
        aquisicao: { mrr_projetado: f.mrr_aquisicao_projetado, mrr_realizado: f.mrr_aquisicao_realizado, onetime_projetado: f.onetime_aquisicao_projetado, onetime_realizado: f.onetime_aquisicao_realizado },
        upsell: { mrr_projetado: f.mrr_upsell_projetado, mrr_realizado: f.mrr_upsell_realizado, onetime_projetado: f.onetime_upsell_projetado, onetime_realizado: f.onetime_upsell_realizado },
        churn: { pct_projetado: f.churn_projetado_pct, clientes_projetado: f.clientes_churn_projetado, clientes_realizado: f.clientes_churn_realizado },
        fechado: f.fechado, fechado_em: f.fechado_em, observacoes: f.observacoes,
      }));
    },
  },

  // ============================================================ HISTÓRICO DE ALTERAÇÕES
  {
    name: "ver_historico_alteracoes",
    title: "Ver histórico de alterações",
    description: "Quem incluiu, alterou ou excluiu dados no sistema e quando (tela e MCP), com os campos que mudaram (antes/depois). O coordenador vê só o histórico dos clientes do seu escopo. Filtros: cliente, usuario (e-mail), dias (padrão 7, máx. 90), limite (padrão 50, máx. 200).",
    inputSchema: {
      type: "object",
      properties: { cliente: CLIENTE, usuario: { type: "string" }, dias: { type: "integer", default: 7 }, limite: { type: "integer", default: 50 } },
    },
    annotations: { readOnlyHint: true },
    papeis: ["gerente", "coordenador"],
    async run(u, a) {
      const dias = Math.min(Math.max(Number(a.dias) || 7, 1), 90);
      const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
      let q = u.supabase.from("ruston_log_alteracoes").select("*").gte("criado_em", desde)
        .order("criado_em", { ascending: false }).limit(Math.min(Number(a.limite) || 50, 200));
      if (a.usuario) q = q.ilike("usuario_email", `%${a.usuario}%`);
      let ids: string[] | null = null;
      if (a.cliente) ids = [(await acharCliente(u, a.cliente)).id];
      else if (u.squadId) ids = (await carteira(u, true)).map((c) => c.id);
      if (ids) {
        if (!ids.length) return { total: 0, alteracoes: [] };
        const lista = ids.join(",");
        q = q.or(`registro_id.in.(${lista}),depois->>cliente_id.in.(${lista}),antes->>cliente_id.in.(${lista})`);
      }
      const rows = ok(await q) as any[];
      return {
        periodo: `últimos ${dias} dia(s)`,
        total: rows.length,
        alteracoes: rows.map((r) => ({
          quando: dataHoraBr(new Date(r.criado_em)), quem: r.usuario_email ?? "sistema", acao: r.acao, tabela: r.tabela,
          registro: r.registro_nome ?? r.registro_id, campos: r.campos_alterados,
          antes: r.acao === "edicao" ? r.antes : undefined, depois: r.acao === "edicao" ? r.depois : undefined,
        })),
      };
    },
  },

  // ============================================================ METAS DA UNIDADE E DOS SQUADS
  {
    name: "ver_metas_unidade",
    title: "Ver metas da unidade e dos squads",
    description: "Metas do mês da unidade (tela Metas) e dos squads, com meta, realizado e observações de cada métrica. Coordenador e gestor veem as da unidade e as do próprio squad. Sem ano/mês usa o mês atual.",
    inputSchema: { type: "object", properties: { ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 } } },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const { ano, mes } = anoMesPadrao(a);
      let qs = u.supabase.from("ruston_metas_squad").select("*").eq("ano", ano).eq("mes", mes).order("ordem");
      if (u.squadId) qs = qs.eq("squad_id", u.squadId);
      const [emp, sq, squads] = await Promise.all([
        u.supabase.from("ruston_metas_empresa").select("*").eq("ano", ano).eq("mes", mes).order("ordem"),
        qs, u.supabase.from("ruston_squads").select("id, nome"),
      ]);
      const nomeSquad = new Map((ok(squads) as any[]).map((s) => [s.id, s.nome]));
      const fmt = (m: any) => ({ id: m.id, metrica: m.metrica_label ?? m.metrica, chave: m.metrica, unidade: m.unidade, meta: m.valor_meta, realizado: m.valor_realizado, observacoes: m.observacoes });
      return {
        mes: `${String(mes).padStart(2, "0")}/${ano}`,
        unidade: (ok(emp) as any[]).map(fmt),
        squads: (ok(sq) as any[]).map((m) => ({ squad: nomeSquad.get(m.squad_id) ?? m.squad_id, ...fmt(m) })),
      };
    },
  },
  {
    name: "salvar_meta_unidade",
    title: "Alterar meta da unidade ou do squad",
    description:
      "Altera a meta, o realizado ou as observações de uma métrica JÁ CADASTRADA no mês (métricas novas são criadas na tela Metas). " +
      "nivel: unidade ou squad. Coordenador e gestor alteram a unidade e o próprio squad. Use ver_metas_unidade para ver as métricas e o id." + DUAS_ETAPAS,
    inputSchema: {
      type: "object",
      properties: {
        nivel: { type: "string", enum: ["unidade", "squad"] },
        metrica: { type: "string", description: "id da meta (de ver_metas_unidade) ou nome da métrica" },
        squad: { type: "string", description: "Só para o gerente, com nivel=squad" },
        ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 },
        valor_meta: { type: ["number", "null"] }, valor_realizado: { type: ["number", "null"] }, observacoes: TEXTO_OU_NULL,
        confirmar: CONFIRMA,
      },
      required: ["nivel", "metrica"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      if (u.somenteLeitura) throw new Error("Este acesso é somente leitura.");
      const { ano, mes } = anoMesPadrao(a);
      const tabela = a.nivel === "squad" ? "ruston_metas_squad" : "ruston_metas_empresa";
      let q = u.supabase.from(tabela).select("*").eq("ano", ano).eq("mes", mes);
      if (a.nivel === "squad") {
        let squadId = u.squadId;
        if (!squadId) {
          if (!a.squad) throw new Error("Informe o squad.");
          const squads = ok(await u.supabase.from("ruston_squads").select("id, nome").eq("ativo", true)) as any[];
          const s = squads.filter((x) => normalizar(x.nome).includes(normalizar(a.squad)));
          if (s.length !== 1) throw new Error(`Squad "${a.squad}" ${s.length ? "ambíguo" : "não encontrado"}. Squads: ${squads.map((x) => x.nome).join(", ")}`);
          squadId = s[0].id;
        }
        q = q.eq("squad_id", squadId);
      }
      const metas = ok(await q) as any[];
      const n = normalizar(a.metrica ?? "");
      const exatos = metas.filter((m) => m.id === a.metrica || normalizar(m.metrica_label ?? "") === n || normalizar(m.metrica ?? "") === n);
      const final = exatos.length ? exatos : metas.filter((m) => normalizar(m.metrica_label ?? m.metrica ?? "").includes(n));
      const mesTxt = `${String(mes).padStart(2, "0")}/${ano}`;
      if (final.length !== 1) {
        throw new Error(final.length
          ? `Mais de uma métrica bate: ${final.map((m) => m.metrica_label ?? m.metrica).join(", ")}.`
          : `Métrica "${a.metrica}" não cadastrada em ${mesTxt}. Métricas: ${metas.map((m) => m.metrica_label ?? m.metrica).join(", ") || "nenhuma"}. Crie na tela Metas.`);
      }
      const m = final[0];
      const campos: Args = {};
      for (const k of ["valor_meta", "valor_realizado", "observacoes"]) {
        if (a[k] === undefined) continue;
        if (k !== "observacoes" && a[k] !== null && (typeof a[k] !== "number" || !isFinite(a[k]))) throw new Error(`${k} precisa ser número.`);
        campos[k] = a[k];
      }
      if (!Object.keys(campos).length) throw new Error("Nada para alterar. Campos: valor_meta, valor_realizado, observacoes.");
      const mudancas = Object.keys(campos)
        .filter((k) => (m[k] != null && k !== "observacoes" ? Number(m[k]) : m[k] ?? null) !== campos[k])
        .map((k) => ({ campo: k, antes: m[k] ?? null, depois: campos[k] }));
      const rotulo = `${m.metrica_label ?? m.metrica} (${a.nivel === "squad" ? "squad" : "unidade"}, ${mesTxt})`;
      if (!mudancas.length) return { ok: true, acao: "sem mudança", metrica: rotulo };
      if (!a.confirmar) return { previa: true, metrica: rotulo, mudancas, aviso: "Nada foi gravado. Mostre ao usuário e chame de novo com confirmar=true." };
      const r = ok(await u.supabase.from(tabela).update({ ...campos, updated_at: new Date().toISOString() }).eq("id", m.id).select("*")) as any[];
      if (!r.length) throw new Error("Sem permissão para alterar esta meta.");
      return { ok: true, metrica: rotulo, mudancas };
    },
  },
];

// ------------------------------------------------------------ auxiliares

const CAMPOS_META = ["meta_leads", "resultado_leads", "meta_faturamento", "resultado_faturamento", "observacoes"];

/** Ano/mês informados ou o mês atual (horário de Brasília). */
function anoMesPadrao(a: Args) {
  const hoje = hojeIsoBr();
  const ano = a.ano ?? Number(hoje.slice(0, 4)), mes = a.mes ?? Number(hoje.slice(5, 7));
  if (!mesValido(mes)) throw new Error("mes precisa ser de 1 a 12.");
  return { ano, mes };
}

/** Clientes ativos (sem churn) que o usuário enxerga — mesma base da tela Metas dos Clientes. */
async function clientesDasMetas(u: UsuarioMcp) {
  let q = u.supabase.from("ruston_clientes_view")
    .select("id, nome, squad_id, squad_nome, account_id, account_nome, churn_realizado").eq("ativo", true).order("nome");
  if (u.squadId) q = q.eq("squad_id", u.squadId);
  return (ok(await q) as any[]).filter((c) => !c.churn_realizado);
}

function linhaMeta(c: any, m: MetaMensal | null | undefined, semanas: MetaSemanal[], ano: number, mes: number, hoje: string) {
  const r = resumoMeta(m, semanas, ano, mes, hoje);
  const um = (p: number | null) => (p == null ? null : Math.round(p * 10) / 10);
  const porSexta = new Map(semanas.map((s) => [s.data_referencia, s]));
  return {
    id: c.id, cliente: c.nome, squad: c.squad_nome ?? null, gp: c.account_nome ?? "Sem GP",
    situacao: r.situacao, pendente: r.pendente,
    leads: { meta: r.metaLeads, realizado: r.realLeads, origem: r.corrigidoLeads ? "total corrigido" : "soma das semanas", soma_semanas: r.somaLeads, pct_meta: um(r.atingLeads), ritmo_pct: r.fechado ? null : um(r.ritmoLeads) },
    faturamento: { meta: r.metaFat, realizado: r.realFat, origem: r.corrigidoFat ? "total corrigido" : "soma das semanas", soma_semanas: r.somaFat, pct_meta: um(r.atingFat), ritmo_pct: r.fechado ? null : um(r.ritmoFat) },
    esperado_ate_agora_pct: r.fechado ? 100 : um(r.fracao * 100),
    semanas: r.sextas.map((s) => {
      const w = porSexta.get(s);
      return { periodo: rotuloSemana(s), leads: w?.leads ?? null, faturamento: w?.faturamento != null ? Number(w.faturamento) : null, lancada: semanaLancada(w), cobrada: semanaCobrada(s, hoje) };
    }),
    semanas_sem_lancar: r.naoLancadas.map(rotuloSemana),
    observacoes: m?.observacoes ?? null,
  };
}

function validarNotas(campos: Args) {
  for (const k of Object.keys(campos).filter((k) => k.startsWith("nota_"))) {
    const v = campos[k];
    if (v != null && (typeof v !== "number" || v < 0 || v > 10)) throw new Error(`${k} precisa ser de 0 a 10.`);
  }
}

/** Valida e converte os campos de tratativa (responsável por nome → id). */
async function prepararCamposTratativa(u: UsuarioMcp, campos: Args) {
  if (campos.status !== undefined && !ABERTOS.includes(campos.status)) {
    throw new Error("Status aqui só solicitado ou em_retencao. Para fechar use encerrar_tratativa_churn.");
  }
  if (campos.risco != null && !["alto", "medio", "baixo"].includes(campos.risco)) throw new Error("risco: alto, medio ou baixo.");
  if (campos.responsavel !== undefined) {
    campos.responsavel_id = (await acharPessoa(u, campos.responsavel))?.id ?? null;
    delete campos.responsavel;
  }
}

/** ROI / ponto de equilíbrio: um registro por cliente+mês. Cria ou corrige (com regra de envio). */
async function salvarMensal(u: UsuarioMcp, tipo: "roi" | "ponto_equilibrio", c: any, ano: number, mes: number, campos: Args) {
  const def = TIPOS[tipo];
  const invalidos = Object.keys(campos).filter((k) => !def.campos.includes(k));
  if (invalidos.length) throw new Error(`Campos desconhecidos: ${invalidos.join(", ")}. Válidos: ${def.campos.join(", ")}`);
  if (!Object.keys(campos).length) throw new Error("Nada para gravar.");
  const existente = ok(await u.supabase.from(def.tabela).select("*").eq("cliente_id", c.id).eq("ano", ano).eq("mes", mes).maybeSingle()) as any;
  const mesTxt = `${String(mes).padStart(2, "0")}/${ano}`;
  if (existente) {
    conferirPermissao(u, tipo, existente, "editar");
    const { registro, mudancas } = await aplicarEdicao(u, tipo, existente, montarPatch(tipo, existente, campos));
    return { registro, saida: { ok: true, acao: "atualizado", id: registro.id, cliente: c.nome, mes: mesTxt, dados: registro.dados, mudancas, ...infoPrazo(u, tipo, registro) } };
  }
  const registro = await criarRegistro(u, tipo, { cliente_id: c.id, ano, mes, dados: campos });
  return { registro, saida: { ok: true, acao: "criado", id: registro.id, cliente: c.nome, mes: mesTxt, dados: registro.dados, mudancas: diferenca(tipo, null, registro), ...infoPrazo(u, tipo, registro) } };
}

export const ferramentasDo = (u: UsuarioMcp) =>
  FERRAMENTAS.filter((f) => (!f.papeis || f.papeis.includes(u.papel)) && (!u.somenteLeitura || f.annotations.readOnlyHint));
