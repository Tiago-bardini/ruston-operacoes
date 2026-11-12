// =====================================================================
// MCP — ferramentas que a IA pode usar
// Cada ferramenta: nome, descrição (a IA lê para decidir quando usar),
// esquema de entrada (JSON Schema) e a função que executa como o usuário.
// Gravações passam por lib/mcp/envios.ts (permissão, prazo e histórico).
// =====================================================================

import type { UsuarioMcp, PapelMcp } from "@/lib/mcp/auth";
import { calcularNotaFinalFca, bandeiraDaNota, sextaDaSemanaFca, ETAPA_LABEL } from "@/lib/types";
import { calcularRoi } from "@/lib/planejamento";
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
        incluir_inativos: { type: "boolean" },
      },
    },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      let lista = await carteira(u, !!a.incluir_inativos);
      if (a.busca) lista = lista.filter((c) => normalizar(c.nome).includes(normalizar(a.busca)));
      if (a.etapa) lista = lista.filter((c) => c.etapa === a.etapa);
      if (a.squad) lista = lista.filter((c) => normalizar(c.squad_nome ?? "").includes(normalizar(a.squad)));
      return {
        total: lista.length,
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
    description: "Ficha de um cliente: cadastro, últimos FCAs, tratativas de churn, ROI dos últimos meses e pesquisas.",
    inputSchema: { type: "object", properties: { cliente: CLIENTE }, required: ["cliente"] },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const [fcas, trat, roi, pesq] = await Promise.all([
        u.supabase.from("ruston_fca_view").select("*").eq("cliente_id", c.id).order("data_referencia", { ascending: false }).limit(4),
        u.supabase.from("ruston_churn_solicitacoes").select("id, data_solicitacao, status, risco, motivo, prazo, encerrado_em, motivo_final")
          .eq("cliente_id", c.id).order("data_solicitacao", { ascending: false }).limit(5),
        u.supabase.from("ruston_cliente_roi_mensal").select("ano, mes, dados")
          .eq("cliente_id", c.id).order("ano", { ascending: false }).order("mes", { ascending: false }).limit(3),
        u.supabase.from("ruston_pesquisas").select("tipo, semana_ee, criada_em, respondida_em, nota")
          .eq("cliente_id", c.id).eq("cancelada", false).order("criada_em", { ascending: false }).limit(5),
      ]);
      return {
        cliente: c,
        fca_recentes: (ok(fcas) as any[]).map(fcaResumo),
        tratativas_churn: ok(trat),
        roi_recente: ok(roi),
        pesquisas: (ok(pesq) as any[]).map((p) => ({ ...p, nome: nomePesquisa(p.tipo, p.semana_ee) })),
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
];

// ------------------------------------------------------------ auxiliares

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
