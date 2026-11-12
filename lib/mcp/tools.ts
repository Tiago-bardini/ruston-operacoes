// =====================================================================
// MCP — ferramentas que a IA pode usar
// Cada ferramenta: nome, descrição (a IA lê para decidir quando usar),
// esquema de entrada (JSON Schema) e a função que executa como o usuário.
// Nada aqui apaga dados.
// =====================================================================

import type { UsuarioMcp, PapelMcp } from "@/lib/mcp/auth";
import { calcularNotaFinalFca, bandeiraDaNota, sextaDaSemanaFca, ETAPA_LABEL } from "@/lib/types";
import { calcularRoi, comPadraoPe } from "@/lib/planejamento";
import { formularioDe, nomePesquisa, perguntaVisivel, type Pesquisa } from "@/lib/pesquisas";

type Args = Record<string, any>;

export type Ferramenta = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, any>;
  annotations?: Record<string, boolean>;
  papeis?: PapelMcp[];  // vazio = todos os papéis do MCP
  run: (u: UsuarioMcp, a: Args) => Promise<unknown>;
};

const CONFIRMAR = " Antes de chamar, mostre ao usuário exatamente o que será gravado e peça confirmação.";

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const mesValido = (m: any) => Number.isInteger(m) && m >= 1 && m <= 12;

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

const NOTA = { type: "number", minimum: 0, maximum: 10 };
const CLIENTE = { type: "string", description: "Nome do cliente (pode ser parcial) ou id" };

export const FERRAMENTAS: Ferramenta[] = [
  // ------------------------------------------------------------ CLIENTES
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
    description: "Ficha de um cliente: dados do cadastro, últimos FCAs, tratativas de churn, ROI dos últimos meses e pesquisas.",
    inputSchema: { type: "object", properties: { cliente: CLIENTE }, required: ["cliente"] },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const [fcas, trat, roi, pesq] = await Promise.all([
        u.supabase.from("ruston_fca_view").select("data_referencia, nota_final, bandeira, status, fato, causa, acao")
          .eq("cliente_id", c.id).order("data_referencia", { ascending: false }).limit(4),
        u.supabase.from("ruston_tratativas_churn").select("data_acao, tipo, descricao, resultado, proximo_passo, proximo_passo_data")
          .eq("cliente_id", c.id).order("data_acao", { ascending: false }).limit(5),
        u.supabase.from("ruston_cliente_roi_mensal").select("ano, mes, dados")
          .eq("cliente_id", c.id).order("ano", { ascending: false }).order("mes", { ascending: false }).limit(3),
        u.supabase.from("ruston_pesquisas").select("tipo, semana_ee, criada_em, respondida_em, nota")
          .eq("cliente_id", c.id).eq("cancelada", false).order("criada_em", { ascending: false }).limit(5),
      ]);
      return {
        cliente: c,
        fca_recentes: ok(fcas),
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
      const novo = ok(await u.supabase.from("ruston_clientes").insert(payload).select("id, nome").single());
      return { ok: true, cliente: novo };
    },
  },

  // ------------------------------------------------------------ FCA
  {
    name: "ver_fca",
    title: "Ver FCA do cliente",
    description: "Histórico de FCA (Fato, Causa, Ação + notas) de um cliente, do mais recente para o mais antigo.",
    inputSchema: { type: "object", properties: { cliente: CLIENTE, limite: { type: "integer", default: 6 } }, required: ["cliente"] },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      const c = await acharCliente(u, a.cliente);
      const fcas = ok(await u.supabase.from("ruston_fca_view").select("*").eq("cliente_id", c.id)
        .order("data_referencia", { ascending: false }).limit(Math.min(a.limite ?? 6, 30)));
      return { cliente: c.nome, sexta_atual: sextaDaSemanaFca(), fcas };
    },
  },
  {
    name: "salvar_fca",
    title: "Preencher / editar FCA",
    description:
      "Cria ou atualiza o FCA de um cliente na semana (referência = sexta-feira). Se já existir FCA nessa data, só os campos enviados mudam. " +
      "Notas de 0 a 10: resultado (peso 7), operacao_trafego (5), prazo (5), qualidade (4), relacionamento (4), roi (8). " +
      "Status: rascunho, aguardando_validacao ou validado (validar só Gerente/Coordenador)." + CONFIRMAR,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        data_referencia: { type: "string", description: "Sexta-feira AAAA-MM-DD. Padrão: sexta da semana atual" },
        nota_resultado: NOTA, nota_operacao_trafego: NOTA, nota_prazo: NOTA,
        nota_qualidade: NOTA, nota_relacionamento: NOTA, nota_roi: NOTA,
        fato: { type: "string" }, causa: { type: "string" }, acao: { type: "string" },
        observacoes: { type: "string" },
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
      if (d.getDay() !== 5) throw new Error(`${dRef} não é sexta-feira. O FCA é sempre na sexta (atual: ${sextaDaSemanaFca()}).`);
      if (a.status === "validado" && u.papel === "gestor") throw new Error("Só Gerente ou Coordenador valida FCA. Use aguardando_validacao.");

      const campos = ["nota_resultado", "nota_operacao_trafego", "nota_prazo", "nota_qualidade", "nota_relacionamento", "nota_roi", "fato", "causa", "acao", "observacoes", "status"];
      const payload: Args = { cliente_id: c.id, data_referencia: dRef, ano: d.getFullYear(), mes: d.getMonth() + 1 };
      for (const k of campos) if (a[k] !== undefined) payload[k] = a[k];
      for (const k of campos.filter((k) => k.startsWith("nota_"))) {
        if (payload[k] != null && (typeof payload[k] !== "number" || payload[k] < 0 || payload[k] > 10)) throw new Error(`${k} precisa ser de 0 a 10.`);
      }
      if (a.status === "validado") payload.validado_at = new Date().toISOString();

      const existente = ok(await u.supabase.from("ruston_fca").select("*").eq("cliente_id", c.id).eq("data_referencia", dRef).maybeSingle()) as any;
      if (existente) {
        ok(await u.supabase.from("ruston_fca").update(payload).eq("id", existente.id));
      } else {
        payload.status = payload.status ?? "rascunho";
        ok(await u.supabase.from("ruston_fca").insert(payload));
      }
      const final = { ...(existente ?? {}), ...payload };
      const nota = calcularNotaFinalFca(final);
      return { ok: true, acao: existente ? "atualizado" : "criado", cliente: c.nome, data_referencia: dRef, nota_final: nota, bandeira: bandeiraDaNota(nota), status: final.status };
    },
  },

  // ------------------------------------------------------------ TRATATIVAS DE CHURN
  {
    name: "ver_tratativas_churn",
    title: "Ver tratativas de churn",
    description: "Lista as tratativas de churn (ações de retenção) de um cliente, ou as em andamento da carteira se nenhum cliente for informado.",
    inputSchema: { type: "object", properties: { cliente: CLIENTE } },
    annotations: { readOnlyHint: true },
    async run(u, a) {
      let q = u.supabase.from("ruston_tratativas_churn")
        .select("id, cliente_id, data_acao, tipo, descricao, resultado, proximo_passo, proximo_passo_data, link_drive, link_task, registrado_por")
        .order("data_acao", { ascending: false }).limit(50);
      const lista = await carteira(u, true);
      const nomes = new Map(lista.map((c) => [c.id, c.nome]));
      if (a.cliente) q = q.eq("cliente_id", (await acharCliente(u, a.cliente)).id);
      else q = q.eq("resultado", "em_andamento").in("cliente_id", Array.from(nomes.keys()));
      const rows = ok(await q) as any[];
      return rows.map((r) => ({ ...r, cliente: nomes.get(r.cliente_id) ?? r.cliente_id }));
    },
  },
  {
    name: "salvar_tratativa_churn",
    title: "Registrar / editar tratativa de churn",
    description:
      "Registra uma ação de retenção para um cliente em risco, ou edita uma existente (passando id). " +
      "tipo: reuniao_stakeholder, ligacao, ajuste_entrega, troca_time, negociacao, fca_dossie, outro. " +
      "resultado: em_andamento (padrão), resolvido, sem_efeito." + CONFIRMAR,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Só para editar uma tratativa existente" },
        cliente: CLIENTE,
        data_acao: { type: "string", description: "AAAA-MM-DD. Padrão: hoje" },
        tipo: { type: "string", enum: ["reuniao_stakeholder", "ligacao", "ajuste_entrega", "troca_time", "negociacao", "fca_dossie", "outro"] },
        descricao: { type: "string" },
        resultado: { type: "string", enum: ["em_andamento", "resolvido", "sem_efeito"] },
        proximo_passo: { type: "string" },
        proximo_passo_data: { type: "string", description: "AAAA-MM-DD" },
        link_drive: { type: "string" },
        link_task: { type: "string" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    papeis: ["gerente", "coordenador"],
    async run(u, a) {
      const campos = ["data_acao", "tipo", "descricao", "resultado", "proximo_passo", "proximo_passo_data", "link_drive", "link_task"];
      const payload: Args = {};
      for (const k of campos) if (a[k] !== undefined) payload[k] = a[k];
      if (a.id) {
        if (Object.keys(payload).length === 0) throw new Error("Nada para alterar.");
        const r = ok(await u.supabase.from("ruston_tratativas_churn").update(payload).eq("id", a.id).select("id")) as any[];
        if (!r.length) throw new Error("Tratativa não encontrada ou você não pode editá-la (coordenador só edita as que registrou).");
        return { ok: true, acao: "atualizada", id: a.id };
      }
      if (!a.cliente || !a.tipo || !a.descricao) throw new Error("Para registrar, informe cliente, tipo e descricao.");
      const c = await acharCliente(u, a.cliente);
      const novo = ok(await u.supabase.from("ruston_tratativas_churn").insert({ cliente_id: c.id, ...payload }).select("id").single()) as any;
      return { ok: true, acao: "registrada", cliente: c.nome, id: novo.id };
    },
  },

  // ------------------------------------------------------------ PLANEJAMENTO / ROI
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
        u.supabase.from("ruston_cliente_pe_mensal").select("ano, mes, dados").eq("cliente_id", c.id)
          .order("ano", { ascending: false }).order("mes", { ascending: false }).limit(12),
        u.supabase.from("ruston_cliente_roi_mensal").select("ano, mes, dados").eq("cliente_id", c.id)
          .order("ano", { ascending: false }).order("mes", { ascending: false }).limit(12),
        u.supabase.from("ruston_cliente_planejamento").select("forecast, ponto_equilibrio, updated_at").eq("cliente_id", c.id).maybeSingle(),
      ]);
      const pes = ok(pe) as any[];
      const rois = (ok(roi) as any[])
        .filter((r) => !a.ano || (r.ano === a.ano && (!a.mes || r.mes === a.mes)))
        .map((r) => {
          const peMes = pes.find((p) => p.ano === r.ano && p.mes === r.mes)?.dados;
          const calc = calcularRoi(r.dados, peMes, Number(c.mrr) || 0);
          return { ano: r.ano, mes: r.mes, preenchido: r.dados, roas: calc.roas, roi_pct: calc.roi != null ? Math.round(calc.roi * 1000) / 10 : null, lucro: calc.lucro, fee_usado: calc.fee, margem_rs: calc.margem };
        });
      return { cliente: c.nome, mrr: c.mrr, roi_mensal: rois, ponto_equilibrio_mensal: pes, forecast: (ok(plan) as any)?.forecast ?? null };
    },
  },
  {
    name: "salvar_roi_mensal",
    title: "Preencher ROI do mês",
    description:
      "Preenche o ROI de um mês do cliente: faturamento (R$), margem_pct (margem de contribuição em %, 40 = 40%), midia (investimento em mídia no mês, R$) e fee_v4 (opcional; vazio usa o fee do planejamento ou o MRR). " +
      "Só os campos enviados mudam. Retorna ROAS, ROI e lucro calculados." + CONFIRMAR,
    inputSchema: {
      type: "object",
      properties: {
        cliente: CLIENTE,
        ano: { type: "integer" }, mes: { type: "integer", minimum: 1, maximum: 12 },
        faturamento: { type: "number" }, margem_pct: { type: "number" }, midia: { type: "number" }, fee_v4: { type: "number" },
      },
      required: ["cliente", "ano", "mes"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(u, a) {
      if (!mesValido(a.mes)) throw new Error("mes precisa ser de 1 a 12.");
      const c = await acharCliente(u, a.cliente);
      const atual = ok(await u.supabase.from("ruston_cliente_roi_mensal").select("dados")
        .eq("cliente_id", c.id).eq("ano", a.ano).eq("mes", a.mes).maybeSingle()) as any;
      const dados = { ...(atual?.dados ?? {}) };
      for (const k of ["faturamento", "margem_pct", "midia", "fee_v4"]) if (a[k] !== undefined) dados[k] = a[k];
      ok(await u.supabase.from("ruston_cliente_roi_mensal")
        .upsert({ cliente_id: c.id, ano: a.ano, mes: a.mes, dados, updated_at: new Date().toISOString() }, { onConflict: "cliente_id,ano,mes" }));
      const pe = ok(await u.supabase.from("ruston_cliente_pe_mensal").select("dados")
        .eq("cliente_id", c.id).eq("ano", a.ano).eq("mes", a.mes).maybeSingle()) as any;
      const calc = calcularRoi(dados, pe?.dados, Number(c.mrr) || 0);
      return { ok: true, cliente: c.nome, mes: `${String(a.mes).padStart(2, "0")}/${a.ano}`, dados, roas: calc.roas, roi_pct: calc.roi != null ? Math.round(calc.roi * 1000) / 10 : null, lucro: calc.lucro };
    },
  },
  {
    name: "salvar_ponto_equilibrio",
    title: "Preencher ponto de equilíbrio do mês",
    description:
      "Preenche o ponto de equilíbrio (planejamento) de um mês do cliente. Campos: produto, periodo, faturamento, qtd_vendas, " +
      "pct_frete, pct_impostos, pct_custo_produto, pct_gateway, pct_comissao, pct_outros_var (em %), fee_v4, ferramentas, equipe_vendas, outros_fixos (R$), " +
      "pct_cac_alvo, pct_cac_aceitavel (%), cac_alvo_valor (R$). Só os campos enviados mudam." + CONFIRMAR,
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
      const permitidos = Object.keys(comPadraoPe({}));
      const extras = Object.keys(a.dados ?? {}).filter((k) => !permitidos.includes(k));
      if (extras.length) throw new Error(`Campos desconhecidos: ${extras.join(", ")}. Válidos: ${permitidos.join(", ")}`);
      const c = await acharCliente(u, a.cliente);
      const atual = ok(await u.supabase.from("ruston_cliente_pe_mensal").select("dados")
        .eq("cliente_id", c.id).eq("ano", a.ano).eq("mes", a.mes).maybeSingle()) as any;
      const dados = { ...(atual?.dados ?? {}), ...a.dados };
      ok(await u.supabase.from("ruston_cliente_pe_mensal")
        .upsert({ cliente_id: c.id, ano: a.ano, mes: a.mes, dados, updated_at: new Date().toISOString() }, { onConflict: "cliente_id,ano,mes" }));
      return { ok: true, cliente: c.nome, mes: `${String(a.mes).padStart(2, "0")}/${a.ano}`, dados };
    },
  },

  // ------------------------------------------------------------ PESQUISAS
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
      const lista = await carteira(u, true);
      const nomes = new Map(lista.map((c) => [c.id, c.nome]));
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

export const ferramentasDo = (u: UsuarioMcp) => FERRAMENTAS.filter((f) => !f.papeis || f.papeis.includes(u.papel));
