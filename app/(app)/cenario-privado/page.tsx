"use client";

// Cenário privado de reestruturação.
// Copia o organograma (squads, pessoas, carteiras) para tabelas próprias
// (ruston_cenario_*, migration 043). O banco só deixa o dono de cada cenário
// ler ou gravar. Nada nesta tela altera clientes, pessoas ou o organograma real.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

type Papel = "gp" | "gt" | "designer" | "lideranca" | "outro";
type Status = "fica" | "sai" | "vaga";
type PapelCarteira = "gp" | "gt" | "designer";

type Cenario = { id: string; nome: string; notas: string | null; meta_saidas: number | null; created_at: string; folha_base?: number | null };
type CSquad = { id: string; cenario_id: string; nome: string; tipo: "squad" | "fixa"; ordem: number; ativo: boolean; origem_area_id: string | null };
type CPessoa = {
  id: string; cenario_id: string; squad_id: string | null; squad_original_id: string | null;
  nome: string; cargo: string | null; papel: Papel; foto_url: string | null;
  status: Status; capacidade: number | null; nota: string | null; ordem: number; origem_pessoa_id: string | null;
  salario?: number | null; // ajuste/estimativa no cenário (migration 044); vazio = salário do cadastro
};
type CCliente = {
  id: string; cenario_id: string; cliente_id: string | null; nome: string;
  mrr: number | null; bandeira: string | null; etapa: string | null; vencimento: string | null;
  gp_id: string | null; gt_id: string | null; designer_id: string | null;
  gp_original_id: string | null; gt_original_id: string | null; designer_original_id: string | null;
  nota: string | null;
};

type Cad = { id: string; nome: string; cargo: string | null; salario: number | null; ativo: boolean; compartilhado_entre_squads: boolean | null };

const CAMPO: Record<PapelCarteira, "gp_id" | "gt_id" | "designer_id"> = { gp: "gp_id", gt: "gt_id", designer: "designer_id" };
const CAMPO_ORIG: Record<PapelCarteira, "gp_original_id" | "gt_original_id" | "designer_original_id"> = {
  gp: "gp_original_id", gt: "gt_original_id", designer: "designer_original_id",
};
const PAPEL_LABEL: Record<Papel, string> = { lideranca: "Liderança", gp: "GP", gt: "GT", designer: "Designer", outro: "Outros" };
const PAPEL_ORDEM: Papel[] = ["lideranca", "gp", "gt", "designer", "outro"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlK = (v: number) => (v >= 1000 ? `R$ ${(Math.round(v / 100) / 10).toString().replace(".", ",")}k` : `R$ ${Math.round(v)}`);
const uuid = () => crypto.randomUUID();

function papelDe(cargoEnum: string | null | undefined, cargoTexto: string | null | undefined): Papel {
  if (cargoEnum === "gestor_projetos") return "gp";
  if (cargoEnum === "gestor_trafego") return "gt";
  if (cargoEnum === "designer") return "designer";
  if (cargoEnum === "coordenador" || cargoEnum === "gerente" || cargoEnum === "coo") return "lideranca";
  const t = norm(cargoTexto ?? "");
  if (/trafego|\bgt\b/.test(t)) return "gt";
  if (/design|\bdg\b/.test(t)) return "designer";
  if (/projet|\bgp\b|account/.test(t)) return "gp";
  if (/coord|gerent|head|lider/.test(t)) return "lideranca";
  return "outro";
}

async function inserirEmLotes(supabase: ReturnType<typeof createClient>, tabela: string, linhas: Record<string, unknown>[]) {
  for (let i = 0; i < linhas.length; i += 400) {
    const { error } = await supabase.from(tabela).insert(linhas.slice(i, i + 400));
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}

export default function CenarioPrivadoPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, podeEditar } = useUsuarioPerfil();
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [cenarioId, setCenarioId] = useState<string | null>(null);
  const [squads, setSquads] = useState<CSquad[]>([]);
  const [pessoas, setPessoas] = useState<CPessoa[]>([]);
  const [clientes, setClientes] = useState<CCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aba, setAba] = useState<"organograma" | "carteiras" | "ferramentas" | "resumo">("organograma");
  const [erroTabela, setErroTabela] = useState<string | null>(null);
  const [salarioCadastro, setSalarioCadastro] = useState<Map<string, number>>(new Map());
  const [cadastro, setCadastro] = useState<Cad[]>([]);
  const [temColSalario, setTemColSalario] = useState(false);
  const [temColFolhaBase, setTemColFolhaBase] = useState(false);
  const [folhaBaseLocal, setFolhaBaseLocal] = useState<Record<string, number | null>>({});

  const cenario = cenarios.find((c) => c.id === cenarioId) ?? null;

  async function carregarCenarios(selecionar?: string) {
    // Mais antigo primeiro: ao abrir a página, entra sempre no cenário 1
    const { data, error } = await supabase.from("ruston_cenarios").select("*").order("created_at", { ascending: true });
    if (error) { setErroTabela(error.message); setLoading(false); return; }
    const lista = (data as Cenario[]) ?? [];
    setCenarios(lista);
    const alvo = selecionar ?? cenarioId ?? lista[0]?.id ?? null;
    setCenarioId(lista.some((c) => c.id === alvo) ? alvo : lista[0]?.id ?? null);
    if (lista.length === 0) setLoading(false);
  }

  async function carregarCenario(id: string) {
    setLoading(true);
    const [{ data: s }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("ruston_cenario_squads").select("*").eq("cenario_id", id).order("ordem"),
      supabase.from("ruston_cenario_pessoas").select("*").eq("cenario_id", id).order("ordem"),
      supabase.from("ruston_cenario_clientes").select("*").eq("cenario_id", id).order("nome"),
    ]);
    setSquads((s as CSquad[]) ?? []);
    setPessoas((p as CPessoa[]) ?? []);
    setClientes((c as CCliente[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (!loadingPerfil && podeEditar) carregarCenarios(); else if (!loadingPerfil) setLoading(false); /* eslint-disable-next-line */ }, [loadingPerfil]);
  useEffect(() => { if (cenarioId) carregarCenario(cenarioId); /* eslint-disable-next-line */ }, [cenarioId]);
  // Pessoa adicionada à mão (sem vínculo) com nome que bate com 1 só ativo do cadastro: liga sozinho, para puxar o salário
  useEffect(() => {
    if (!cadastro.length || !pessoas.length) return;
    const ligados = new Set(pessoas.map((p) => p.origem_pessoa_id).filter(Boolean));
    pessoas.filter((p) => !p.origem_pessoa_id && p.status !== "vaga").forEach((p) => {
      const tk = norm(p.nome).split(" ").filter(Boolean);
      const cands = cadastro.filter((r) => r.ativo && !ligados.has(r.id) && tk.every((t) => norm(r.nome).split(" ").includes(t)));
      if (cands.length === 1) { ligados.add(cands[0].id); atualizarPessoa(p.id, { origem_pessoa_id: cands[0].id }); }
    });
    // eslint-disable-next-line
  }, [cadastro, pessoas.length, cenarioId]);
  useEffect(() => {
    if (loadingPerfil || !podeEditar) return;
    supabase.from("ruston_pessoas").select("id,nome,cargo,salario,ativo,compartilhado_entre_squads").then(({ data }) => {
      const lista = (data as Cad[]) ?? [];
      const m = new Map<string, number>();
      lista.forEach((r) => { if (r.salario != null) m.set(r.id, Number(r.salario)); });
      setSalarioCadastro(m);
      setCadastro(lista);
    });
    supabase.from("ruston_cenario_pessoas").select("salario").limit(1).then(({ error }) => setTemColSalario(!error));
    supabase.from("ruston_cenarios").select("folha_base").limit(1).then(({ error }) => setTemColFolhaBase(!error));
    try { setFolhaBaseLocal(JSON.parse(localStorage.getItem("cenario_folha_base") ?? "{}")); } catch { /* sem storage */ }
    // eslint-disable-next-line
  }, [loadingPerfil, podeEditar]);

  // ------------------------------------------------------------------
  // Criar cenário: fotografia do organograma + carteiras de hoje
  // ------------------------------------------------------------------
  async function criarDoOrganograma() {
    const nome = prompt("Nome do cenário:", `Reestruturação ${new Date().toLocaleDateString("pt-BR")}`);
    if (!nome) return;
    setOcupado("Copiando o organograma e as carteiras...");
    try {
      const [{ data: areas }, { data: orgPessoas }, { data: rPessoas }, { data: rSquads }, { data: cli }, { data: fcas }] = await Promise.all([
        supabase.from("ruston_org_areas").select("id,nome,tipo,ordem").eq("ativo", true).order("ordem"),
        supabase.from("ruston_org_pessoas").select("id,area_id,nome,cargo,foto_url,linha,coluna,ruston_pessoa_id,capacidade").eq("ativo", true).order("linha").order("coluna"),
        supabase.from("ruston_pessoas").select("id,nome,cargo,squad_id,foto_url,ativo"),
        supabase.from("ruston_squads").select("id,nome"),
        supabase.from("ruston_clientes")
          .select("id,nome,mrr,etapa,data_vencimento_contrato,account_id,gestor_trafego_id,designer_id,churn_realizado,subiu_no_sistema")
          .eq("ativo", true),
        supabase.from("ruston_fca_view").select("cliente_id,bandeira,data_referencia").order("data_referencia", { ascending: false }),
      ]);

      const cenId = uuid();
      const { error: e1 } = await supabase.from("ruston_cenarios").insert({ id: cenId, nome, meta_saidas: 7 });
      if (e1) throw new Error(e1.message);

      // Squads / áreas
      const squadPorArea = new Map<string, string>();
      const linhasSquads: Record<string, unknown>[] = ((areas as { id: string; nome: string; tipo: string; ordem: number }[]) ?? []).map((a, i) => {
        const id = uuid();
        squadPorArea.set(a.id, id);
        return { id, cenario_id: cenId, nome: a.nome, tipo: a.tipo === "fixa" ? "fixa" : "squad", ordem: a.ordem ?? i * 10, origem_area_id: a.id };
      });
      const squadPorNome = new Map<string, string>();
      ((areas as { id: string; nome: string }[]) ?? []).forEach((a) => squadPorNome.set(norm(a.nome), squadPorArea.get(a.id)!));
      const nomeRSquad = new Map<string, string>();
      ((rSquads as { id: string; nome: string }[]) ?? []).forEach((s) => nomeRSquad.set(s.id, s.nome));

      // Pessoas do organograma -> cadastro (ruston_pessoas)
      type RP = { id: string; nome: string; cargo: string | null; squad_id: string | null; foto_url: string | null; ativo: boolean };
      const rp = (rPessoas as RP[]) ?? [];
      const rpPorId = new Map(rp.map((x) => [x.id, x]));
      const usados = new Set<string>();
      const pessoaPorCadastro = new Map<string, string>(); // ruston_pessoas.id -> cenario_pessoas.id
      const linhasPessoas: Record<string, unknown>[] = [];
      type OP = { id: string; area_id: string; nome: string; cargo: string | null; foto_url: string | null; ruston_pessoa_id: string | null; capacidade: number | null };
      // Quem está inativo no cadastro (já saiu) não entra no cenário
      const ops = ((orgPessoas as OP[]) ?? []).filter((o) => !o.ruston_pessoa_id || rpPorId.get(o.ruston_pessoa_id)?.ativo !== false);
      ops.forEach((o) => { if (o.ruston_pessoa_id) usados.add(o.ruston_pessoa_id); });
      ops.forEach((o, i) => {
        let cadastroId = o.ruston_pessoa_id;
        if (!cadastroId) {
          const tk = norm(o.nome).split(" ").filter(Boolean);
          const cands = rp.filter((r) => r.ativo && !usados.has(r.id) && tk.every((t) => norm(r.nome).split(" ").includes(t)));
          if (cands.length === 1) { cadastroId = cands[0].id; usados.add(cadastroId); }
        }
        const id = uuid();
        if (cadastroId) pessoaPorCadastro.set(cadastroId, id);
        const squadId = squadPorArea.get(o.area_id) ?? null;
        linhasPessoas.push({
          id, cenario_id: cenId, squad_id: squadId, squad_original_id: squadId,
          nome: o.nome, cargo: o.cargo, papel: papelDe(cadastroId ? rpPorId.get(cadastroId)?.cargo : null, o.cargo),
          foto_url: o.foto_url ?? (cadastroId ? rpPorId.get(cadastroId)?.foto_url ?? null : null),
          capacidade: o.capacidade, ordem: i, origem_pessoa_id: cadastroId,
        });
      });

      // Clientes ativos (mesmo filtro do organograma)
      type CL = { id: string; nome: string; mrr: number | null; etapa: string | null; data_vencimento_contrato: string | null; account_id: string | null; gestor_trafego_id: string | null; designer_id: string | null; churn_realizado: boolean; subiu_no_sistema: boolean };
      // Cliente cujo GP já saiu (inativo no cadastro) também fica de fora
      const cls = ((cli as CL[]) ?? []).filter((x) => !(x.churn_realizado && x.subiu_no_sistema))
        .filter((x) => !x.account_id || rpPorId.get(x.account_id)?.ativo !== false);

      // Quem atende cliente mas não está no organograma entra mesmo assim
      let foraId: string | null = null;
      const garantirPessoa = (cadastroId: string | null, papel: PapelCarteira): string | null => {
        if (!cadastroId) return null;
        const ja = pessoaPorCadastro.get(cadastroId);
        if (ja) return ja;
        const r = rpPorId.get(cadastroId);
        if (!r || !r.ativo) return null;
        let squadId = r.squad_id ? squadPorNome.get(norm(nomeRSquad.get(r.squad_id) ?? "")) ?? null : null;
        if (!squadId) {
          if (!foraId) {
            foraId = uuid();
            linhasSquads.push({ id: foraId, cenario_id: cenId, nome: "FORA DO ORGANOGRAMA", tipo: "squad", ordem: 9999 });
          }
          squadId = foraId;
        }
        const id = uuid();
        pessoaPorCadastro.set(cadastroId, id);
        linhasPessoas.push({
          id, cenario_id: cenId, squad_id: squadId, squad_original_id: squadId, nome: r.nome, cargo: null,
          papel: papelDe(r.cargo, null) === "outro" ? papel : papelDe(r.cargo, null), foto_url: r.foto_url,
          ordem: linhasPessoas.length, origem_pessoa_id: cadastroId,
        });
        return id;
      };

      const bandeiras = new Map<string, string>();
      ((fcas as { cliente_id: string; bandeira: string }[]) ?? []).forEach((f) => { if (!bandeiras.has(f.cliente_id)) bandeiras.set(f.cliente_id, f.bandeira); });

      const linhasClientes = cls.map((c) => {
        const gp = garantirPessoa(c.account_id, "gp");
        const gt = garantirPessoa(c.gestor_trafego_id, "gt");
        const dg = garantirPessoa(c.designer_id, "designer");
        return {
          id: uuid(), cenario_id: cenId, cliente_id: c.id, nome: c.nome, mrr: c.mrr, bandeira: bandeiras.get(c.id) ?? null,
          etapa: c.etapa, vencimento: c.data_vencimento_contrato,
          gp_id: gp, gt_id: gt, designer_id: dg, gp_original_id: gp, gt_original_id: gt, designer_original_id: dg,
        };
      });

      // Quem tem carteira ganha o papel certo, mesmo com cargo genérico
      const papelPorUso = new Map<string, PapelCarteira>();
      linhasClientes.forEach((c) => {
        if (c.gp_id) papelPorUso.set(c.gp_id, "gp");
        if (c.gt_id && !papelPorUso.has(c.gt_id)) papelPorUso.set(c.gt_id, "gt");
        if (c.designer_id && !papelPorUso.has(c.designer_id)) papelPorUso.set(c.designer_id, "designer");
      });
      linhasPessoas.forEach((p) => {
        const uso = papelPorUso.get(p.id as string);
        if (uso && p.papel === "outro") p.papel = uso;
      });

      await inserirEmLotes(supabase, "ruston_cenario_squads", linhasSquads);
      await inserirEmLotes(supabase, "ruston_cenario_pessoas", linhasPessoas);
      await inserirEmLotes(supabase, "ruston_cenario_clientes", linhasClientes);
      await carregarCenarios(cenId);
    } catch (e) {
      alert("Não consegui criar o cenário: " + (e as Error).message);
    }
    setOcupado(null);
  }

  // Clientes ativos do sistema que ainda não estão no cenário (ex.: cadastrados depois)
  type Novo = { id: string; nome: string; mrr: number | null; etapa: string | null; vencimento: string | null; gp: string | null; gt: string | null; dg: string | null; bandeira: string | null; gpNome: string };
  const [novos, setNovos] = useState<Novo[] | null>(null);

  async function buscarClientesNovos() {
    if (!cenario) return;
    setOcupado("Procurando clientes do sistema que não estão no cenário...");
    const [{ data: cli, error }, { data: fcas }, { data: rPessoas }] = await Promise.all([
      supabase.from("ruston_clientes")
        .select("id,nome,mrr,etapa,data_vencimento_contrato,account_id,gestor_trafego_id,designer_id,churn_realizado,subiu_no_sistema")
        .eq("ativo", true),
      supabase.from("ruston_fca_view").select("cliente_id,bandeira,data_referencia").order("data_referencia", { ascending: false }),
      supabase.from("ruston_pessoas").select("id,nome"),
    ]);
    setOcupado(null);
    if (error) { alert("Não consegui ler os clientes: " + error.message); return; }
    type CL = { id: string; nome: string; mrr: number | null; etapa: string | null; data_vencimento_contrato: string | null; account_id: string | null; gestor_trafego_id: string | null; designer_id: string | null; churn_realizado: boolean; subiu_no_sistema: boolean };
    const jaNoCenario = new Set(clientes.map((c) => c.cliente_id).filter(Boolean));
    const nomesNoCenario = new Set(clientes.map((c) => norm(c.nome)));
    const pessoaPorCadastro = new Map(pessoas.filter((p) => p.origem_pessoa_id).map((p) => [p.origem_pessoa_id!, p.id]));
    const nomeCadastro = new Map(((rPessoas as { id: string; nome: string }[]) ?? []).map((x) => [x.id, x.nome]));
    const bandeiras = new Map<string, string>();
    ((fcas as { cliente_id: string; bandeira: string }[]) ?? []).forEach((x) => { if (!bandeiras.has(x.cliente_id)) bandeiras.set(x.cliente_id, x.bandeira); });
    const lista = ((cli as CL[]) ?? [])
      .filter((c) => !(c.churn_realizado && c.subiu_no_sistema))
      .filter((c) => !jaNoCenario.has(c.id) && !nomesNoCenario.has(norm(c.nome)))
      .map((c) => ({
        id: c.id, nome: c.nome, mrr: c.mrr, etapa: c.etapa, vencimento: c.data_vencimento_contrato,
        gp: c.account_id ? pessoaPorCadastro.get(c.account_id) ?? null : null,
        gt: c.gestor_trafego_id ? pessoaPorCadastro.get(c.gestor_trafego_id) ?? null : null,
        dg: c.designer_id ? pessoaPorCadastro.get(c.designer_id) ?? null : null,
        bandeira: bandeiras.get(c.id) ?? null,
        gpNome: c.account_id ? nomeCadastro.get(c.account_id) ?? "—" : "sem GP",
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    setNovos(lista);
  }

  async function incluirClientesNovos(lista: Novo[]) {
    if (!cenario || lista.length === 0) { setNovos(null); return; }
    const linhas = lista.map((c) => ({
      id: uuid(), cenario_id: cenario.id, cliente_id: c.id, nome: c.nome, mrr: c.mrr, bandeira: c.bandeira,
      etapa: c.etapa, vencimento: c.vencimento,
      gp_id: c.gp, gt_id: c.gt, designer_id: c.dg, gp_original_id: c.gp, gt_original_id: c.gt, designer_original_id: c.dg,
    }));
    const { data, error } = await supabase.from("ruston_cenario_clientes").insert(linhas).select("*");
    if (error) { alert("Não consegui incluir: " + error.message); return; }
    setClientes((prev) => [...prev, ...((data as CCliente[]) ?? [])].sort((a, b) => a.nome.localeCompare(b.nome)));
    setNovos(null);
  }

  async function duplicarCenario() {
    if (!cenario) return;
    const nome = prompt("Nome da cópia:", `${cenario.nome} (cópia)`);
    if (!nome) return;
    setOcupado("Duplicando o cenário...");
    try {
      const cenId = uuid();
      const { error } = await supabase.from("ruston_cenarios").insert({ id: cenId, nome, notas: cenario.notas, meta_saidas: cenario.meta_saidas });
      if (error) throw new Error(error.message);
      const mapa = new Map<string, string>();
      const novo = (old: string | null) => (old ? mapa.get(old) ?? null : null);
      squads.forEach((s) => mapa.set(s.id, uuid()));
      pessoas.forEach((p) => mapa.set(p.id, uuid()));
      await inserirEmLotes(supabase, "ruston_cenario_squads", squads.map((s) => ({
        id: mapa.get(s.id), cenario_id: cenId, nome: s.nome, tipo: s.tipo, ordem: s.ordem, ativo: s.ativo, origem_area_id: s.origem_area_id,
      })));
      await inserirEmLotes(supabase, "ruston_cenario_pessoas", pessoas.map((p) => ({
        id: mapa.get(p.id), cenario_id: cenId, squad_id: novo(p.squad_id), squad_original_id: novo(p.squad_original_id),
        nome: p.nome, cargo: p.cargo, papel: p.papel, foto_url: p.foto_url, status: p.status, capacidade: p.capacidade,
        nota: p.nota, ordem: p.ordem, origem_pessoa_id: p.origem_pessoa_id,
        ...(temColSalario ? { salario: p.salario ?? null } : {}),
      })));
      await inserirEmLotes(supabase, "ruston_cenario_clientes", clientes.map((c) => ({
        id: uuid(), cenario_id: cenId, cliente_id: c.cliente_id, nome: c.nome, mrr: c.mrr, bandeira: c.bandeira, etapa: c.etapa,
        vencimento: c.vencimento, gp_id: novo(c.gp_id), gt_id: novo(c.gt_id), designer_id: novo(c.designer_id),
        gp_original_id: novo(c.gp_original_id), gt_original_id: novo(c.gt_original_id), designer_original_id: novo(c.designer_original_id), nota: c.nota,
      })));
      // Ferramentas (se a tabela já existir — migration 048)
      const { data: fs } = await supabase.from("ruston_cenario_ferramentas").select("*").eq("cenario_id", cenario.id);
      if (fs && fs.length) {
        await inserirEmLotes(supabase, "ruston_cenario_ferramentas", (fs as Ferramenta[]).map((x) => ({
          cenario_id: cenId, nome: x.nome, quem_usa: x.quem_usa, valor: x.valor, periodicidade: x.periodicidade,
          manter: x.manter, observacao: x.observacao, ordem: x.ordem,
        })));
      }
      await carregarCenarios(cenId);
    } catch (e) {
      alert("Não consegui duplicar: " + (e as Error).message);
    }
    setOcupado(null);
  }

  async function renomearCenario() {
    if (!cenario) return;
    const nome = prompt("Novo nome:", cenario.nome);
    if (!nome) return;
    await supabase.from("ruston_cenarios").update({ nome, updated_at: new Date().toISOString() }).eq("id", cenario.id);
    carregarCenarios(cenario.id);
  }

  async function apagarCenario() {
    if (!cenario) return;
    if (!confirm(`Apagar o cenário "${cenario.nome}"? Isso não mexe no sistema, só apaga esta simulação.`)) return;
    await supabase.from("ruston_cenarios").delete().eq("id", cenario.id);
    setCenarioId(null);
    carregarCenarios("");
  }

  // Folha atual informada à mão (ex.: valor do financeiro). Sem a migration 044, fica só neste navegador.
  const folhaBase: number | null = cenario
    ? (temColFolhaBase ? cenario.folha_base ?? null : null) ?? folhaBaseLocal[cenario.id] ?? null
    : null;
  async function salvarFolhaBase(v: number | null) {
    if (!cenario) return;
    if (temColFolhaBase) { await salvarCenario({ folha_base: v }); return; }
    const novo = { ...folhaBaseLocal, [cenario.id]: v };
    setFolhaBaseLocal(novo);
    try { localStorage.setItem("cenario_folha_base", JSON.stringify(novo)); } catch { /* sem storage */ }
  }

  async function salvarCenario(campos: Partial<Cenario>) {
    if (!cenario) return;
    setCenarios((prev) => prev.map((c) => (c.id === cenario.id ? { ...c, ...campos } : c)));
    await supabase.from("ruston_cenarios").update({ ...campos, updated_at: new Date().toISOString() }).eq("id", cenario.id);
  }

  // ------------------------------------------------------------------
  // Edição
  // ------------------------------------------------------------------
  async function atualizarPessoa(id: string, campos: Partial<CPessoa>) {
    setPessoas((prev) => prev.map((p) => (p.id === id ? { ...p, ...campos } : p)));
    await supabase.from("ruston_cenario_pessoas").update(campos).eq("id", id);
  }

  async function novaPessoa(squadId: string | null) {
    const nome = prompt("Nome (ou \"Vaga GT\", \"Vaga Designer\"...):");
    if (!nome || !cenarioId) return;
    const papel = papelDe(null, nome);
    const linha = {
      id: uuid(), cenario_id: cenarioId, squad_id: squadId, squad_original_id: null, nome, cargo: null,
      papel, foto_url: null, status: (/vaga/i.test(nome) ? "vaga" : "fica") as Status, capacidade: null, nota: null,
      ordem: pessoas.length, origem_pessoa_id: null,
    };
    const { error } = await supabase.from("ruston_cenario_pessoas").insert(linha);
    if (!error) setPessoas((prev) => [...prev, linha]);
  }

  async function incluirDoCadastro(r: Cad, squadId: string | null) {
    if (!cenarioId) return;
    const linha = {
      id: uuid(), cenario_id: cenarioId, squad_id: squadId, squad_original_id: squadId, nome: r.nome, cargo: null,
      papel: papelDe(r.cargo, null), foto_url: null, status: "fica" as Status, capacidade: null, nota: null,
      ordem: pessoas.length, origem_pessoa_id: r.id,
    };
    const { error } = await supabase.from("ruston_cenario_pessoas").insert(linha);
    if (error) { alert("Não consegui incluir: " + error.message); return; }
    setPessoas((prev) => [...prev, linha]);
  }

  async function removerPessoa(p: CPessoa) {
    if (!confirm(`Tirar ${p.nome} do cenário? Os clientes dela ficam sem responsável nesse papel.`)) return;
    await supabase.from("ruston_cenario_pessoas").delete().eq("id", p.id);
    setPessoas((prev) => prev.filter((x) => x.id !== p.id));
    setClientes((prev) => prev.map((c) => ({
      ...c,
      gp_id: c.gp_id === p.id ? null : c.gp_id,
      gt_id: c.gt_id === p.id ? null : c.gt_id,
      designer_id: c.designer_id === p.id ? null : c.designer_id,
    })));
  }

  async function novoSquad() {
    const nome = prompt("Nome do squad:");
    if (!nome || !cenarioId) return;
    const linha = { id: uuid(), cenario_id: cenarioId, nome: nome.toUpperCase(), tipo: "squad" as const, ordem: (squads.length + 1) * 10, ativo: true, origem_area_id: null };
    const { error } = await supabase.from("ruston_cenario_squads").insert(linha);
    if (!error) setSquads((prev) => [...prev, linha]);
  }

  async function renomearSquad(s: CSquad) {
    const nome = prompt("Nome do squad:", s.nome);
    if (!nome) return;
    setSquads((prev) => prev.map((x) => (x.id === s.id ? { ...x, nome: nome.toUpperCase() } : x)));
    await supabase.from("ruston_cenario_squads").update({ nome: nome.toUpperCase() }).eq("id", s.id);
  }

  // Clientes "da pessoa": onde ela é GP; se não for GP de ninguém, onde ela atende no próprio papel
  function clientesDaPessoa(p: CPessoa): CCliente[] {
    const comoGp = clientes.filter((c) => c.gp_id === p.id);
    if (comoGp.length || p.papel === "gp") return comoGp;
    if (p.papel === "gt" || p.papel === "designer") return clientes.filter((c) => c[CAMPO[p.papel as PapelCarteira]] === p.id);
    return [];
  }

  async function excluirClientes(ids: string[]) {
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 200) {
      await supabase.from("ruston_cenario_clientes").delete().in("id", ids.slice(i, i + 200));
    }
    const set = new Set(ids);
    setClientes((prev) => prev.filter((c) => !set.has(c.id)));
  }

  async function excluirPessoaComClientes(p: CPessoa) {
    const lista = clientesDaPessoa(p);
    if (!confirm(`Excluir ${p.nome} do cenário junto com ${lista.length} cliente(s)?\n\n${lista.map((c) => c.nome).join(", ")}\n\nNão conta como desligamento.`)) return;
    await excluirClientes(lista.map((c) => c.id));
    await supabase.from("ruston_cenario_pessoas").delete().eq("id", p.id);
    setPessoas((prev) => prev.filter((x) => x.id !== p.id));
    setClientes((prev) => prev.map((c) => ({
      ...c,
      gp_id: c.gp_id === p.id ? null : c.gp_id,
      gt_id: c.gt_id === p.id ? null : c.gt_id,
      designer_id: c.designer_id === p.id ? null : c.designer_id,
    })));
  }

  async function excluirSquadComTudo(s: CSquad) {
    const membros = pessoas.filter((p) => p.squad_id === s.id);
    const ids = new Set(membros.map((p) => p.id));
    const lista = clientes.filter((c) => c.gp_id && ids.has(c.gp_id));
    if (!confirm(`Excluir o squad ${s.nome} do cenário, com ${membros.length} pessoa(s) e ${lista.length} cliente(s)?\n\nNinguém dele conta como desligamento.`)) return;
    await excluirClientes(lista.map((c) => c.id));
    if (membros.length) await supabase.from("ruston_cenario_pessoas").delete().in("id", Array.from(ids));
    await supabase.from("ruston_cenario_squads").delete().eq("id", s.id);
    setPessoas((prev) => prev.filter((p) => !ids.has(p.id)));
    setSquads((prev) => prev.filter((x) => x.id !== s.id));
    setClientes((prev) => prev.map((c) => ({
      ...c,
      gt_id: c.gt_id && ids.has(c.gt_id) ? null : c.gt_id,
      designer_id: c.designer_id && ids.has(c.designer_id) ? null : c.designer_id,
    })));
  }

  async function excluirCliente(c: CCliente) {
    if (!confirm(`Excluir ${c.nome} do cenário?`)) return;
    await excluirClientes([c.id]);
  }

  async function encerrarSquad(s: CSquad) {
    const qtd = pessoas.filter((p) => p.squad_id === s.id).length;
    if (!confirm(`Encerrar o squad ${s.nome}?${qtd ? ` As ${qtd} pessoas dele vão para "Sem squad".` : ""}`)) return;
    setSquads((prev) => prev.map((x) => (x.id === s.id ? { ...x, ativo: false } : x)));
    setPessoas((prev) => prev.map((p) => (p.squad_id === s.id ? { ...p, squad_id: null } : p)));
    await supabase.from("ruston_cenario_squads").update({ ativo: false }).eq("id", s.id);
    await supabase.from("ruston_cenario_pessoas").update({ squad_id: null }).eq("cenario_id", s.cenario_id).eq("squad_id", s.id);
  }

  async function moverCliente(clienteId: string, papel: PapelCarteira, pessoaId: string | null) {
    const campo = CAMPO[papel];
    setClientes((prev) => prev.map((c) => (c.id === clienteId ? { ...c, [campo]: pessoaId } : c)));
    await supabase.from("ruston_cenario_clientes").update({ [campo]: pessoaId }).eq("id", clienteId);
  }

  async function salvarNotaCliente(clienteId: string, campos: { nota: string | null; mrr: number | null }) {
    setClientes((prev) => prev.map((c) => (c.id === clienteId ? { ...c, ...campos } : c)));
    const { error } = await supabase.from("ruston_cenario_clientes").update(campos).eq("id", clienteId);
    if (error) alert(`Não consegui salvar o cliente: ${error.message}`);
  }

  // ------------------------------------------------------------------
  // Números
  // ------------------------------------------------------------------
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const squadsAtivos = useMemo(() => squads.filter((s) => s.ativo).sort((a, b) => a.ordem - b.ordem), [squads]);

  const semResponsavel = (c: CCliente, papel: PapelCarteira) => {
    const id = c[CAMPO[papel]];
    if (!id) return true;
    return pessoaPorId.get(id)?.status === "sai";
  };

  const indicadores = useMemo(() => {
    const listaHoje = pessoas.filter((p) => p.origem_pessoa_id || p.squad_original_id).filter((p) => p.status !== "vaga");
    const listaDepois = pessoas.filter((p) => p.status !== "sai");
    const hoje = listaHoje.length;
    const depois = listaDepois.length;
    const sal = (p: CPessoa) => p.salario ?? (p.origem_pessoa_id ? salarioCadastro.get(p.origem_pessoa_id) ?? null : null);
    const saindo = pessoas.filter((p) => p.status === "sai");
    const vagas = pessoas.filter((p) => p.status === "vaga");
    const folhaSaindo = saindo.reduce((t, p) => t + (sal(p) ?? 0), 0);
    const folhaVagas = vagas.reduce((t, p) => t + (sal(p) ?? 0), 0);
    const folhaCalculada = listaHoje.reduce((t, p) => t + (sal(p) ?? 0), 0);
    // Com folha base informada: depois = base − quem sai + vagas novas
    const folhaHoje = folhaBase ?? folhaCalculada;
    const folhaDepois = folhaBase != null ? folhaBase - folhaSaindo + folhaVagas : listaDepois.reduce((t, p) => t + (sal(p) ?? 0), 0);
    const semSalario = folhaBase != null
      ? [...saindo, ...vagas].filter((p) => sal(p) == null)
      : [...listaHoje, ...listaDepois.filter((p) => !listaHoje.includes(p))].filter((p) => sal(p) == null);
    const trocaGp = clientes.filter((c) => c.gp_id !== c.gp_original_id);
    const trocaGt = clientes.filter((c) => c.gt_id !== c.gt_original_id);
    const trocaDg = clientes.filter((c) => c.designer_id !== c.designer_original_id);
    return {
      hoje, depois, saindo, folhaHoje, folhaDepois, semSalario, salarioDe: sal, folhaSaindo, folhaVagas, folhaCalculada, folhaBase,
      semGp: clientes.filter((c) => semResponsavel(c, "gp")).length,
      semGt: clientes.filter((c) => semResponsavel(c, "gt")).length,
      semDg: clientes.filter((c) => semResponsavel(c, "designer")).length,
      trocaGp, trocaGt, trocaDg,
      mrrTrocaGp: trocaGp.reduce((s, c) => s + (c.mrr ?? 0), 0),
      vermelhosTrocaGp: trocaGp.filter((c) => c.bandeira === "vermelho").length,
      mrrTotal: clientes.reduce((s, c) => s + (c.mrr ?? 0), 0),
    };
    // eslint-disable-next-line
  }, [pessoas, clientes, pessoaPorId, salarioCadastro, folhaBase]);

  // ------------------------------------------------------------------
  if (loadingPerfil) return <p className="text-brand-muted">Carregando...</p>;
  if (!podeEditar) {
    return <p className="text-brand-muted">Você não tem acesso a esta tela.</p>;
  }
  if (erroTabela) {
    return (
      <div className="max-w-xl rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        <p className="font-semibold">Falta criar as tabelas do cenário no banco.</p>
        <p className="mt-1 text-xs">Rode a migration <code>043_cenarios_privados.sql</code> no SQL Editor do Supabase e recarregue a página.</p>
        <p className="mt-2 text-[11px] text-amber-300/70">Detalhe: {erroTabela}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">🔒 Cenário de reestruturação</h1>
          <p className="text-sm text-brand-muted">
            Só você vê esta tela e estes dados. Nada aqui muda clientes, pessoas ou o organograma do sistema.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cenarios.length > 0 && (
            <select className="input w-auto py-1.5 text-xs" value={cenarioId ?? ""} onChange={(e) => setCenarioId(e.target.value)}>
              {cenarios.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          )}
          <button className="btn text-xs" onClick={criarDoOrganograma} disabled={!!ocupado}>+ Novo cenário do organograma atual</button>
          {cenario && (
            <>
              <button className="btn-ghost text-xs" onClick={buscarClientesNovos} disabled={!!ocupado} title="Traz clientes cadastrados no sistema que ainda não estão neste cenário">↻ Clientes novos</button>
              <button className="btn-ghost text-xs" onClick={duplicarCenario} disabled={!!ocupado}>Duplicar</button>
              <button className="btn-ghost text-xs" onClick={renomearCenario}>Renomear</button>
              <button className="btn-ghost text-xs text-red-300" onClick={apagarCenario}>Apagar</button>
            </>
          )}
        </div>
      </div>

      {novos && <ModalClientesNovos lista={novos} pessoaPorId={pessoaPorId} onFechar={() => setNovos(null)} onIncluir={incluirClientesNovos} />}

      {ocupado && <p className="mb-4 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-brand-muted">{ocupado}</p>}

      {!cenario && !loading && !ocupado && (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
          <p className="text-sm text-white">Nenhum cenário ainda.</p>
          <p className="mt-1 text-xs text-brand-muted">Clique em <strong>+ Novo cenário do organograma atual</strong> para copiar squads, pessoas e carteiras de hoje.</p>
        </div>
      )}

      {cenario && loading && <p className="text-brand-muted">Carregando cenário...</p>}

      {cenario && !loading && (
        <>
          <Indicadores ind={indicadores} meta={cenario.meta_saidas} onMeta={(v) => salvarCenario({ meta_saidas: v })} />

          <div className="mb-5 flex gap-2 border-b border-white/5 pb-3">
            {([["organograma", "👥 Organograma"], ["carteiras", "📋 Carteiras"], ["ferramentas", "🧰 Ferramentas"], ["resumo", "📊 Resumo p/ diretoria"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setAba(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${aba === k ? "bg-brand text-white" : "bg-white/5 text-brand-muted hover:bg-white/10 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>

          {aba === "organograma" && (
            <Organograma
              squads={squadsAtivos} pessoas={pessoas} clientes={clientes}
              onAtualizar={atualizarPessoa} onNova={novaPessoa} onRemover={removerPessoa} onExcluirComClientes={excluirPessoaComClientes} onExcluirSquad={excluirSquadComTudo}
              onNovoSquad={novoSquad} onRenomearSquad={renomearSquad} onEncerrarSquad={encerrarSquad}
              salarioDe={indicadores.salarioDe} salarioCadastroDe={(p) => (p.origem_pessoa_id ? salarioCadastro.get(p.origem_pessoa_id) ?? null : null)} temColSalario={temColSalario} cadastro={cadastro}
            />
          )}
          {aba === "carteiras" && (
            <Carteiras squads={squadsAtivos} pessoas={pessoas} clientes={clientes} pessoaPorId={pessoaPorId}
              onMover={moverCliente} onExcluir={excluirCliente} onCapacidade={(id, v) => atualizarPessoa(id, { capacidade: v })}
              onNota={salvarNotaCliente} />
          )}
          {aba === "ferramentas" && <Ferramentas cenarioId={cenario.id} />}
          {aba === "resumo" && (
            <Resumo cenario={cenario} squads={squadsAtivos} todosSquads={squads} pessoas={pessoas} clientes={clientes}
              pessoaPorId={pessoaPorId} ind={indicadores} onNotas={(v) => salvarCenario({ notas: v })}
              cadastro={cadastro} onIncluir={incluirDoCadastro} onFolhaBase={salvarFolhaBase} />
          )}
        </>
      )}
    </div>
  );
}

// ======================================================================
// Indicadores do topo
// ======================================================================
type Ind = {
  hoje: number; depois: number; saindo: CPessoa[]; semGp: number; semGt: number; semDg: number;
  trocaGp: CCliente[]; trocaGt: CCliente[]; trocaDg: CCliente[]; mrrTrocaGp: number; vermelhosTrocaGp: number; mrrTotal: number;
  folhaHoje: number; folhaDepois: number; semSalario: CPessoa[]; salarioDe: (p: CPessoa) => number | null;
  folhaSaindo: number; folhaVagas: number; folhaCalculada: number; folhaBase: number | null;
};

function Indicadores({ ind, meta, onMeta }: { ind: Ind; meta: number | null; onMeta: (v: number | null) => void }) {
  const pend = ind.semGp + ind.semGt + ind.semDg;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi titulo="Pessoas" valor={`${ind.hoje} → ${ind.depois}`} sub="hoje → no cenário" />
      <Kpi titulo="Saindo" valor={
        <span>
          {ind.saindo.length}
          <span className="text-sm text-brand-muted"> / </span>
          <input type="number" defaultValue={meta ?? ""} placeholder="meta"
            className="w-10 bg-transparent text-sm text-brand-muted outline-none border-b border-white/10 focus:border-brand"
            onBlur={(e) => onMeta(e.target.value === "" ? null : Number(e.target.value))} />
        </span>
      } sub="desligamentos / meta" tom={meta != null && ind.saindo.length === meta ? "ok" : undefined} />
      <Kpi titulo="A redistribuir" valor={String(pend)} sub={`sem GP ${ind.semGp} · GT ${ind.semGt} · DG ${ind.semDg}`} tom={pend > 0 ? "alerta" : "ok"} />
      <Kpi titulo="Trocam de GP" valor={String(ind.trocaGp.length)} sub={`${brlK(ind.mrrTrocaGp)} de MRR`} tom={ind.trocaGp.length > 0 ? "atencao" : undefined} />
      <Kpi titulo="Vermelhos trocando GP" valor={String(ind.vermelhosTrocaGp)} sub="maior risco de churn" tom={ind.vermelhosTrocaGp > 0 ? "alerta" : "ok"} />
      <Kpi titulo="Trocam GT / DG" valor={`${ind.trocaGt.length} / ${ind.trocaDg.length}`} sub="o cliente quase não sente" />
    </div>
  );
}

function Kpi({ titulo, valor, sub, tom }: { titulo: string; valor: React.ReactNode; sub: string; tom?: "ok" | "atencao" | "alerta" }) {
  const cor = tom === "alerta" ? "border-red-500/40" : tom === "atencao" ? "border-amber-500/40" : tom === "ok" ? "border-emerald-500/40" : "border-white/10";
  return (
    <div className={`rounded-xl border ${cor} bg-white/[0.02] p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-muted">{titulo}</p>
      <div className="mt-1 text-xl font-bold text-white">{valor}</div>
      <p className="mt-0.5 text-[10px] text-brand-muted">{sub}</p>
    </div>
  );
}

// ======================================================================
// Organograma do cenário
// ======================================================================
function Organograma({ squads, pessoas, clientes, onAtualizar, onNova, onRemover, onExcluirComClientes, onExcluirSquad, onNovoSquad, onRenomearSquad, onEncerrarSquad, salarioDe, salarioCadastroDe, temColSalario, cadastro }: {
  salarioDe: (p: CPessoa) => number | null; salarioCadastroDe: (p: CPessoa) => number | null; temColSalario: boolean; cadastro: Cad[];
  squads: CSquad[]; pessoas: CPessoa[]; clientes: CCliente[];
  onAtualizar: (id: string, c: Partial<CPessoa>) => void; onNova: (squadId: string | null) => void; onRemover: (p: CPessoa) => void;
  onExcluirComClientes: (p: CPessoa) => void; onExcluirSquad: (s: CSquad) => void;
  onNovoSquad: () => void; onRenomearSquad: (s: CSquad) => void; onEncerrarSquad: (s: CSquad) => void;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [editando, setEditando] = useState<CPessoa | null>(null);
  const carga = useMemo(() => {
    const m = new Map<string, { gp: number; gt: number; designer: number; mrr: number }>();
    const add = (id: string | null, k: PapelCarteira, mrr: number) => {
      if (!id) return;
      const v = m.get(id) ?? { gp: 0, gt: 0, designer: 0, mrr: 0 };
      v[k] += 1;
      if (k === "gp") v.mrr += mrr;
      m.set(id, v);
    };
    clientes.forEach((c) => { add(c.gp_id, "gp", c.mrr ?? 0); add(c.gt_id, "gt", 0); add(c.designer_id, "designer", 0); });
    return m;
  }, [clientes]);

  const semSquad = pessoas.filter((p) => !p.squad_id || !squads.some((s) => s.id === p.squad_id));
  const blocos: { squad: CSquad | null; lista: CPessoa[] }[] = [
    ...squads.map((s) => ({ squad: s, lista: pessoas.filter((p) => p.squad_id === s.id) })),
    ...(semSquad.length ? [{ squad: null, lista: semSquad }] : []),
  ];

  return (
    <div onDragEnd={() => setArrastando(null)}>
      <p className="mb-3 text-xs text-brand-muted">
        Clique no status para alternar <strong className="text-emerald-300">Fica</strong> / <strong className="text-red-300">Sai</strong> · Arraste a pessoa para outro squad · Clique no nome para editar
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {blocos.map(({ squad, lista }) => (
          <SquadCard key={squad?.id ?? "sem"} squad={squad} lista={lista} carga={carga} arrastando={arrastando} setArrastando={setArrastando}
            onSoltar={(pid) => onAtualizar(pid, { squad_id: squad?.id ?? null })}
            onAtualizar={onAtualizar} onEditar={setEditando} onNova={() => onNova(squad?.id ?? null)}
            onRenomear={squad ? () => onRenomearSquad(squad) : undefined} onEncerrar={squad ? () => onEncerrarSquad(squad) : undefined} onExcluir={squad ? () => onExcluirSquad(squad) : undefined} />
        ))}
        <button onClick={onNovoSquad} className="min-h-[120px] rounded-2xl border-2 border-dashed border-white/10 text-xs text-brand-muted hover:border-brand hover:text-brand">
          + squad
        </button>
      </div>
      {editando && (
        <ModalPessoa pessoa={editando} squads={squads} onFechar={() => setEditando(null)}
          temColSalario={temColSalario} cadastro={cadastro} vinculados={new Set(pessoas.filter((x) => x.id !== editando.id).map((x) => x.origem_pessoa_id).filter(Boolean) as string[])}
          onSalvar={(c) => { onAtualizar(editando.id, c); setEditando(null); }}
          onRemover={() => { onRemover(editando); setEditando(null); }}
          onExcluirComClientes={() => { onExcluirComClientes(editando); setEditando(null); }} />
      )}
    </div>
  );
}

function SquadCard({ squad, lista, carga, arrastando, setArrastando, onSoltar, onAtualizar, onEditar, onNova, onRenomear, onEncerrar, onExcluir }: {
  squad: CSquad | null; lista: CPessoa[]; carga: Map<string, { gp: number; gt: number; designer: number; mrr: number }>;
  arrastando: string | null; setArrastando: (id: string | null) => void; onSoltar: (pessoaId: string) => void;
  onAtualizar: (id: string, c: Partial<CPessoa>) => void; onEditar: (p: CPessoa) => void; onNova: () => void;
  onRenomear?: () => void; onEncerrar?: () => void; onExcluir?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const ficam = lista.filter((p) => p.status !== "sai").length;
  const mrr = lista.filter((p) => p.status !== "sai").reduce((s, p) => s + (carga.get(p.id)?.mrr ?? 0), 0);
  return (
    <div
      onDragOver={(e) => { if (arrastando) { e.preventDefault(); setHover(true); } }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => { e.preventDefault(); setHover(false); if (arrastando) { onSoltar(arrastando); setArrastando(null); } }}
      className={`rounded-2xl border-2 bg-white/[0.02] p-4 transition ${hover ? "border-emerald-400 bg-emerald-500/10" : "border-red-500/50"}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-white">{squad?.nome ?? "SEM SQUAD"}</h2>
          <p className="text-[11px] text-brand-muted">{ficam} pessoas no cenário{mrr > 0 && <> · <span className="text-emerald-300">{brlK(mrr)} MRR</span></>}</p>
        </div>
        {squad && (
          <div className="flex gap-2 text-[10px]">
            <button onClick={onRenomear} className="text-brand-muted hover:text-white">renomear</button>
            <button onClick={onEncerrar} className="text-red-300/70 hover:text-red-300" title="O squad deixa de existir; as pessoas ficam sem squad">encerrar</button>
            <button onClick={onExcluir} className="text-red-300/70 hover:text-red-300" title="Tira o squad, as pessoas e os clientes dele do cenário">excluir tudo</button>
          </div>
        )}
      </div>
      {PAPEL_ORDEM.map((papel) => {
        const grupo = lista.filter((p) => p.papel === papel).sort((a, b) => a.ordem - b.ordem);
        if (!grupo.length) return null;
        return (
          <div key={papel} className="mb-3">
            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-brand-muted">{PAPEL_LABEL[papel]}</p>
            <div className="space-y-1.5">
              {grupo.map((p) => (
                <PessoaLinha key={p.id} p={p} carga={carga.get(p.id)} arrastando={arrastando === p.id}
                  onDragStart={() => setArrastando(p.id)} onEditar={() => onEditar(p)}
                  onStatus={() => onAtualizar(p.id, { status: p.status === "fica" ? "sai" : p.status === "sai" ? (p.origem_pessoa_id || p.squad_original_id ? "fica" : "vaga") : "fica" })} />
              ))}
            </div>
          </div>
        );
      })}
      <button onClick={onNova} className="mt-1 text-[11px] text-brand-muted hover:text-brand">+ pessoa ou vaga</button>
    </div>
  );
}

function PessoaLinha({ p, carga, arrastando, onDragStart, onEditar, onStatus }: {
  p: CPessoa; carga?: { gp: number; gt: number; designer: number; mrr: number }; arrastando: boolean;
  onDragStart: () => void; onEditar: () => void; onStatus: () => void;
}) {
  const iniciais = p.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const sai = p.status === "sai";
  const vaga = p.status === "vaga";
  const qtd = carga ? (p.papel === "gt" ? carga.gt : p.papel === "designer" ? carga.designer : carga.gp || carga.gt || carga.designer) : 0;
  const acima = p.capacidade != null && qtd > p.capacidade;
  const mudouSquad = p.squad_original_id != null && p.squad_original_id !== p.squad_id;
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", p.id); } catch {} onDragStart(); }}
      className={`flex cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 active:cursor-grabbing ${
        sai ? "border-red-500/40 bg-red-500/10" : vaga ? "border-dashed border-sky-400/40 bg-sky-500/5" : "border-white/10 bg-white/[0.03]"
      } ${arrastando ? "opacity-40" : ""}`}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-red-600 to-red-800 text-[11px] font-black text-white">
        {p.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.foto_url} alt="" className={`h-full w-full object-cover ${sai ? "grayscale" : ""}`} draggable={false} />
        ) : iniciais}
      </div>
      <button onClick={onEditar} className="min-w-0 flex-1 text-left">
        <p className={`truncate text-xs font-semibold uppercase ${sai ? "text-red-200 line-through" : "text-white"}`}>
          {p.nome}{mudouSquad && <span className="ml-1 text-[9px] font-normal normal-case text-sky-300">mudou de squad</span>}
        </p>
        <p className="truncate text-[10px] text-brand-muted">
          {p.cargo ?? PAPEL_LABEL[p.papel]}
          {qtd > 0 && <> · <span className={acima ? "text-red-300 font-bold" : ""}>{qtd}{p.capacidade != null ? `/${p.capacidade}` : ""} clientes</span></>}
          {carga && carga.mrr > 0 && <> · {brlK(carga.mrr)}</>}
        </p>
        {p.nota && <p className="truncate text-[10px] italic text-amber-200/80">{p.nota}</p>}
      </button>
      <button onClick={onStatus} title="Alternar status"
        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${sai ? "bg-red-500/20 text-red-300" : vaga ? "bg-sky-500/20 text-sky-300" : "bg-emerald-500/15 text-emerald-300"}`}>
        {sai ? "SAI" : vaga ? "VAGA" : "FICA"}
      </button>
    </div>
  );
}

function ModalPessoa({ pessoa, squads, onFechar, onSalvar, onRemover, onExcluirComClientes, temColSalario, cadastro, vinculados }: {
  temColSalario: boolean; cadastro: Cad[]; vinculados: Set<string>;
  pessoa: CPessoa; squads: CSquad[]; onFechar: () => void; onSalvar: (c: Partial<CPessoa>) => void; onRemover: () => void;
  onExcluirComClientes: () => void;
}) {
  const [f, setF] = useState({
    nome: pessoa.nome, cargo: pessoa.cargo ?? "", papel: pessoa.papel, squad_id: pessoa.squad_id ?? "",
    status: pessoa.status, capacidade: pessoa.capacidade?.toString() ?? "", nota: pessoa.nota ?? "",
    salario: pessoa.salario?.toString() ?? "", origem: pessoa.origem_pessoa_id ?? "",
  });
  const cad = cadastro.find((r) => r.id === f.origem);
  const salarioCadastro = cad?.salario != null ? Number(cad.salario) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-brand-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-semibold">Pessoa no cenário</h3>
          <button onClick={onFechar} className="text-brand-muted hover:text-white">✕</button>
        </div>
        <div className="mb-3"><label className="label">Nome</label><input className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
        <div className="mb-3"><label className="label">Cargo</label><input className="input" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} /></div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Papel</label>
            <select className="input" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}>
              {PAPEL_ORDEM.map((p) => <option key={p} value={p}>{PAPEL_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>
              <option value="fica">Fica</option><option value="sai">Sai</option><option value="vaga">Vaga (contratar)</option>
            </select>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Squad</label>
            <select className="input" value={f.squad_id} onChange={(e) => setF({ ...f, squad_id: e.target.value })}>
              <option value="">— sem squad —</option>
              {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Capacidade (clientes)</label>
            <input type="number" className="input" value={f.capacidade} onChange={(e) => setF({ ...f, capacidade: e.target.value })} placeholder="ex: 25" />
          </div>
        </div>
        <div className="mb-3">
          <label className="label">Cadastro de Pessoas (de onde vem o salário)</label>
          <select className="input" value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })}>
            <option value="">— sem vínculo (sem salário) —</option>
            {cadastro.filter((r) => (r.ativo && !vinculados.has(r.id)) || r.id === f.origem)
              .sort((a, b) => a.nome.localeCompare(b.nome))
              .map((r) => <option key={r.id} value={r.id}>{r.nome}{r.cargo ? ` · ${r.cargo}` : ""}{r.salario != null ? ` · ${brl(Number(r.salario))}` : " · sem salário"}</option>)}
          </select>
        </div>
        <div className="mb-3">
          <label className="label">Salário no cenário (R$/mês)</label>
          {temColSalario ? (
            <input type="number" className="input" value={f.salario} onChange={(e) => setF({ ...f, salario: e.target.value })}
              placeholder={salarioCadastro != null ? `cadastro: ${brl(salarioCadastro)}` : f.status === "vaga" ? "estimativa da vaga" : "sem salário no cadastro"} />
          ) : (
            <p className="text-xs text-brand-muted">{salarioCadastro != null ? `${brl(salarioCadastro)} (cadastro)` : "sem salário no cadastro"} · para ajustar aqui, rode a migration 044.</p>
          )}
          <p className="mt-1 text-[10px] text-brand-muted">Vazio = usa o salário do cadastro de Pessoas.</p>
        </div>
        <div className="mb-4"><label className="label">Nota (motivo, observação)</label>
          <textarea className="input min-h-[70px]" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
        </div>
        <div className="flex justify-between gap-2">
          <div className="flex flex-col items-start gap-1">
            <button className="text-xs text-red-300 hover:text-red-400" onClick={onRemover} title="Os clientes ficam, sem responsável">Tirar do cenário</button>
            <button className="text-xs text-red-300 hover:text-red-400" onClick={onExcluirComClientes} title="Para quem já saiu ou não entra na conta">Excluir com os clientes</button>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button className="btn" onClick={() => onSalvar({
              nome: f.nome.trim() || pessoa.nome, cargo: f.cargo.trim() || null, papel: f.papel, squad_id: f.squad_id || null,
              status: f.status, capacidade: f.capacidade === "" ? null : Number(f.capacidade), nota: f.nota.trim() || null,
              origem_pessoa_id: f.origem || null,
              ...(temColSalario ? { salario: f.salario === "" ? null : Number(f.salario) } : {}),
            })}>Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// Carteiras: redistribuição de clientes por papel
// ======================================================================
const BOLINHA: Record<string, string> = {
  verde: "bg-emerald-500", amarelo: "bg-amber-500", vermelho: "bg-red-500",
};

function Carteiras({ squads, pessoas, clientes, pessoaPorId, onMover, onExcluir, onCapacidade, onNota }: {
  squads: CSquad[]; pessoas: CPessoa[]; clientes: CCliente[]; pessoaPorId: Map<string, CPessoa>;
  onMover: (clienteId: string, papel: PapelCarteira, pessoaId: string | null) => void;
  onExcluir: (c: CCliente) => void;
  onCapacidade: (pessoaId: string, v: number | null) => void;
  onNota: (clienteId: string, campos: { nota: string | null; mrr: number | null }) => void;
}) {
  const [papel, setPapel] = useState<PapelCarteira>("gp");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const aberto = abertoId ? clientes.find((c) => c.id === abertoId) ?? null : null;
  const comNota = clientes.filter((c) => c.nota && c.nota.trim()).length;
  const campo = CAMPO[papel];
  const ordemSquad = new Map(squads.map((s, i) => [s.id, i]));
  const colunas = pessoas
    .filter((p) => p.status !== "sai" && (p.papel === papel || clientes.some((c) => c[campo] === p.id)))
    .sort((a, b) => (ordemSquad.get(a.squad_id ?? "") ?? 999) - (ordemSquad.get(b.squad_id ?? "") ?? 999) || a.nome.localeCompare(b.nome));
  const pendentes = clientes.filter((c) => {
    const id = c[campo];
    return !id || pessoaPorId.get(id)?.status === "sai" || !colunas.some((p) => p.id === id);
  });
  const nomeSquad = new Map(squads.map((s) => [s.id, s.nome]));

  // Pendentes agrupados por quem atendia
  const grupos = new Map<string, CCliente[]>();
  pendentes.forEach((c) => {
    const id = c[campo];
    const chave = id ? pessoaPorId.get(id)?.nome ?? "—" : "Sem responsável";
    grupos.set(chave, [...(grupos.get(chave) ?? []), c]);
  });

  return (
    <div onDragEnd={() => setArrastando(null)}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-white/5 p-1">
          {(["gp", "gt", "designer"] as PapelCarteira[]).map((k) => (
            <button key={k} onClick={() => setPapel(k)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${papel === k ? "bg-brand text-white" : "text-brand-muted hover:text-white"}`}>
              {PAPEL_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="text-xs text-brand-muted">Arraste o cliente para o novo responsável. Clique no cliente para abrir e anotar. Contorno azul = mudou de {PAPEL_LABEL[papel]} em relação a hoje.</p>
        {comNota > 0 && <span className="text-[11px] text-amber-200">📝 {comNota} com observação</span>}
      </div>
      {aberto && (
        <ModalCliente c={aberto} pessoaPorId={pessoaPorId} onFechar={() => setAbertoId(null)}
          onSalvar={(campos) => { onNota(aberto.id, campos); setAbertoId(null); }} />
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        <Coluna titulo="⚠️ A redistribuir" sub={`${pendentes.length} clientes · ${brlK(pendentes.reduce((s, c) => s + (c.mrr ?? 0), 0))}`}
          destaque arrastando={arrastando} onSoltar={(cid) => onMover(cid, papel, null)}>
          {pendentes.length === 0 && <p className="py-6 text-center text-[11px] text-emerald-300">Tudo distribuído ✓</p>}
          {Array.from(grupos.entries()).map(([quem, lista]) => (
            <div key={quem} className="mb-2">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-red-300/80">de {quem} ({lista.length})</p>
              <div className="space-y-1.5">
                {lista.map((c) => <ClienteCard key={c.id} c={c} papel={papel} pessoaPorId={pessoaPorId} onDrag={() => setArrastando(c.id)} onExcluir={() => onExcluir(c)} onAbrir={() => setAbertoId(c.id)} />)}
              </div>
            </div>
          ))}
        </Coluna>
        {colunas.map((p) => {
          const lista = clientes.filter((c) => c[campo] === p.id).sort((a, b) => (b.mrr ?? 0) - (a.mrr ?? 0));
          const mrr = lista.reduce((s, c) => s + (c.mrr ?? 0), 0);
          const verm = lista.filter((c) => c.bandeira === "vermelho").length;
          const acima = p.capacidade != null && lista.length > p.capacidade;
          return (
            <Coluna key={p.id} arrastando={arrastando} onSoltar={(cid) => onMover(cid, papel, p.id)}
              titulo={<>{p.nome}{p.status === "vaga" && <span className="ml-1 text-[9px] text-sky-300">VAGA</span>}</>}
              sub={<>
                {nomeSquad.get(p.squad_id ?? "") ?? "sem squad"} · {brlK(mrr)}{verm > 0 && <span className="text-red-300"> · {verm} 🔴</span>}
              </>}
              contador={
                <span className={`text-xs font-bold ${acima ? "text-red-300" : "text-white"}`}>
                  {lista.length}
                  <span className="text-brand-muted font-normal"> / </span>
                  <input type="number" defaultValue={p.capacidade ?? ""} placeholder="cap"
                    onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== p.capacidade) onCapacidade(p.id, v); }}
                    className="w-8 bg-transparent text-xs text-amber-300 outline-none border-b border-white/10 focus:border-amber-400" />
                </span>
              }>
              <div className="space-y-1.5">
                {lista.map((c) => <ClienteCard key={c.id} c={c} papel={papel} pessoaPorId={pessoaPorId} onDrag={() => setArrastando(c.id)} onExcluir={() => onExcluir(c)} onAbrir={() => setAbertoId(c.id)} />)}
                {lista.length === 0 && <p className="py-6 text-center text-[11px] text-brand-muted italic">sem clientes</p>}
              </div>
            </Coluna>
          );
        })}
      </div>
    </div>
  );
}

function Coluna({ titulo, sub, contador, destaque, arrastando, onSoltar, children }: {
  titulo: React.ReactNode; sub: React.ReactNode; contador?: React.ReactNode; destaque?: boolean;
  arrastando: string | null; onSoltar: (clienteId: string) => void; children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onDragOver={(e) => { if (arrastando) { e.preventDefault(); setHover(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setHover(false); }}
      onDrop={(e) => { e.preventDefault(); setHover(false); if (arrastando) onSoltar(arrastando); }}
      className={`flex w-64 flex-shrink-0 flex-col rounded-xl border-2 p-3 transition ${
        hover ? "border-emerald-400 bg-emerald-500/10" : destaque ? "border-red-500/40 bg-red-500/5" : "border-white/10 bg-white/[0.02]"
      }`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase text-white">{titulo}</p>
          <p className="truncate text-[10px] text-brand-muted">{sub}</p>
        </div>
        {contador}
      </div>
      <div className="max-h-[60vh] overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

function ClienteCard({ c, papel, pessoaPorId, onDrag, onExcluir, onAbrir }: { c: CCliente; papel: PapelCarteira; pessoaPorId: Map<string, CPessoa>; onDrag: () => void; onExcluir: () => void; onAbrir: () => void }) {
  const orig = c[CAMPO_ORIG[papel]];
  const mudou = orig !== c[CAMPO[papel]];
  const antes = orig ? pessoaPorId.get(orig)?.nome : null;
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", c.id); } catch {} onDrag(); }}
      onClick={onAbrir}
      title={c.nota ? c.nota : mudou ? `Hoje: ${antes ?? "sem responsável"}` : "Clique para abrir e anotar"}
      className={`group cursor-grab rounded-lg border bg-white/[0.03] px-2 py-1.5 active:cursor-grabbing ${mudou ? "border-sky-400/60" : "border-white/10"}`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${BOLINHA[c.bandeira ?? ""] ?? "bg-white/20"}`} />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase text-white">{c.nome}</p>
        {c.nota && <span className="text-[10px]" title="Tem observação">📝</span>}
        <button onClick={(e) => { e.stopPropagation(); onExcluir(); }} title="Excluir do cenário" className="text-[10px] text-red-300 opacity-0 transition group-hover:opacity-100 hover:text-red-400">✕</button>
      </div>
      <div className="ml-4 flex flex-wrap gap-1 text-[9px]">
        {c.mrr ? <span className="text-emerald-300">{brl(c.mrr)}</span> : null}
        {mudou && <span className="text-sky-300">antes: {antes ?? "—"}</span>}
      </div>
      {c.nota && <p className="ml-4 mt-0.5 line-clamp-2 text-[9px] italic text-amber-200/80">{c.nota}</p>}
    </div>
  );
}

// Clientes do sistema que não estão no cenário: escolher quais incluir
function ModalClientesNovos<T extends { id: string; nome: string; mrr: number | null; gp: string | null; gpNome: string }>({ lista, pessoaPorId, onFechar, onIncluir }: {
  lista: T[]; pessoaPorId: Map<string, CPessoa>; onFechar: () => void; onIncluir: (l: T[]) => void;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const alternar = (id: string) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-brand-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between">
          <h3 className="text-lg font-semibold">Clientes do sistema fora do cenário</h3>
          <button onClick={onFechar} className="text-brand-muted hover:text-white">✕</button>
        </div>
        <p className="mb-3 text-xs text-brand-muted">
          Marque os que quer trazer. Quem você excluiu de propósito (ex.: clientes do Caio ou do ISAAS) também aparece aqui. É só não marcar.
        </p>
        {lista.length === 0 && <p className="py-6 text-center text-sm text-emerald-300">Todos os clientes ativos do sistema já estão no cenário ✓</p>}
        <ul className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
          {lista.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 px-2 py-1.5 text-xs hover:bg-white/5">
                <input type="checkbox" checked={marcados.has(c.id)} onChange={() => alternar(c.id)} />
                <span className="flex-1 font-semibold uppercase text-white">{c.nome}</span>
                <span className="text-brand-muted">GP: {c.gp ? pessoaPorId.get(c.gp)?.nome ?? c.gpNome : `${c.gpNome} (fora do cenário)`}</span>
                {c.mrr ? <span className="text-emerald-300">{brl(c.mrr)}</span> : null}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn" disabled={marcados.size === 0} onClick={() => onIncluir(lista.filter((c) => marcados.has(c.id)))}>
            Incluir {marcados.size || ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// Abrir o cliente: dados e observação do contato (só no cenário, só o dono vê)
function ModalCliente({ c, pessoaPorId, onFechar, onSalvar }: {
  c: CCliente; pessoaPorId: Map<string, CPessoa>; onFechar: () => void; onSalvar: (campos: { nota: string | null; mrr: number | null }) => void;
}) {
  const [nota, setNota] = useState(c.nota ?? "");
  const [fee, setFee] = useState(c.mrr != null ? String(c.mrr) : "");
  const nome = (id: string | null) => (id ? pessoaPorId.get(id)?.nome ?? "—" : "—");
  const linhas: [string, string | null, string | null][] = [
    ["GP", c.gp_original_id, c.gp_id], ["GT", c.gt_original_id, c.gt_id], ["Designer", c.designer_original_id, c.designer_id],
  ];
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const carimbar = () => setNota((n) => `${n.trim() ? `${n.trimEnd()}\n\n` : ""}${hoje} – `);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-brand-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-lg font-semibold uppercase">
              <span className={`h-3 w-3 flex-shrink-0 rounded-full ${BOLINHA[c.bandeira ?? ""] ?? "bg-white/20"}`} />
              <span className="truncate">{c.nome}</span>
            </h3>
            <p className="text-xs text-brand-muted">
              {c.mrr ? `Fee ${brl(c.mrr)}` : "sem fee"}{c.etapa ? ` · ${c.etapa}` : ""}{c.vencimento ? ` · vence ${new Date(c.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
          <button onClick={onFechar} className="text-brand-muted hover:text-white">✕</button>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 text-[11px]">
          {linhas.map(([rot, orig, atual]) => (
            <div key={rot} className="rounded-md border border-white/10 px-2 py-1.5">
              <p className="text-[9px] uppercase tracking-widest text-brand-muted">{rot}</p>
              {orig !== atual
                ? <p><span className="text-brand-muted line-through">{nome(orig)}</span> <span className="text-sky-300">→ {nome(atual)}</span></p>
                : <p className="text-white">{nome(atual)}</p>}
            </div>
          ))}
        </div>
        <div className="mb-4">
          <label className="label">Fee mensal (R$)</label>
          <input type="number" className="input" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="ex: 10000" />
          <p className="mt-1 text-[10px] text-brand-muted">Muda só no cenário (MRR das carteiras e do resumo). O cadastro do cliente não é alterado.</p>
        </div>
        <div className="mb-1 flex items-center justify-between">
          <label className="label mb-0">Observação</label>
          <button className="text-[11px] text-brand hover:underline" onClick={carimbar}>+ anotação de hoje ({hoje})</button>
        </div>
        <textarea autoFocus className="input min-h-[200px] text-sm" value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder={"Como foi o contato, o que o cliente falou, clima da relação...\nComo abordar na próxima semana (troca de GP)..."} />
        <p className="mt-1 text-[10px] text-brand-muted">Fica só neste cenário. Ninguém além de você vê.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn" onClick={() => onSalvar({ nota: nota.trim() || null, mrr: fee.trim() === "" ? null : Number(fee.replace(",", ".")) })}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// Ferramentas: o que se paga, quem usa e o que continua
// ======================================================================
type QuemUsa = "lideranca" | "gp" | "gt" | "dg" | "tech" | "todos";
type Ferramenta = {
  id: string; cenario_id: string; nome: string; quem_usa: QuemUsa; valor: number | null;
  periodicidade: Periodicidade; manter: boolean; observacao: string | null; ordem: number;
};
const QUEM_USA: { v: QuemUsa; label: string }[] = [
  { v: "lideranca", label: "Liderança" }, { v: "gp", label: "GP" }, { v: "gt", label: "GT" }, { v: "dg", label: "DG" }, { v: "tech", label: "Tech" }, { v: "todos", label: "Todos" },
];
// mensal = valor por mês · anual_12x = total do ano, pago em 12 parcelas · anual = total do ano, pago 1x à vista
type Periodicidade = "mensal" | "anual_12x" | "anual";
const PERIODICIDADES: { v: Periodicidade; label: string }[] = [
  { v: "mensal", label: "Mensal" }, { v: "anual_12x", label: "Anual em 12x" }, { v: "anual", label: "Anual à vista (1x)" },
];
const mensalDe = (f: Ferramenta) => (Number(f.valor) || 0) / (f.periodicidade === "mensal" ? 1 : 12);

function Ferramentas({ cenarioId }: { cenarioId: string }) {
  const supabase = createClient();
  const [lista, setLista] = useState<Ferramenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase.from("ruston_cenario_ferramentas").select("*").eq("cenario_id", cenarioId).order("ordem").order("created_at")
      .then(({ data, error }) => {
        setErro(error ? error.message : null);
        setLista((data as Ferramenta[]) ?? []);
        setLoading(false);
      });
    // eslint-disable-next-line
  }, [cenarioId]);

  async function salvar(id: string, campos: Partial<Ferramenta>) {
    setLista((prev) => prev.map((f) => (f.id === id ? { ...f, ...campos } : f)));
    await supabase.from("ruston_cenario_ferramentas").update(campos).eq("id", id);
  }
  async function nova() {
    const ordem = lista.reduce((m, f) => Math.max(m, f.ordem), 0) + 1;
    const { data, error } = await supabase.from("ruston_cenario_ferramentas")
      .insert({ cenario_id: cenarioId, nome: "", ordem }).select("*").single();
    if (error) { alert("Não consegui criar: " + error.message); return; }
    setLista((prev) => [...prev, data as Ferramenta]);
  }
  async function remover(f: Ferramenta) {
    if (!confirm(`Excluir ${f.nome || "esta ferramenta"}?`)) return;
    setLista((prev) => prev.filter((x) => x.id !== f.id));
    await supabase.from("ruston_cenario_ferramentas").delete().eq("id", f.id);
  }

  if (loading) return <p className="text-brand-muted">Carregando ferramentas...</p>;
  if (erro) {
    return (
      <div className="max-w-xl rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        <p className="font-semibold">Falta criar a tabela de ferramentas no banco.</p>
        <p className="mt-1 text-xs">Rode a migration <code>048_cenario_ferramentas.sql</code> no SQL Editor do Supabase e recarregue a página.</p>
      </div>
    );
  }

  const totalHoje = lista.reduce((t, f) => t + mensalDe(f), 0);
  const totalDepois = lista.filter((f) => f.manter).reduce((t, f) => t + mensalDe(f), 0);
  const economia = totalHoje - totalDepois;
  const avistaHoje = lista.filter((f) => f.periodicidade === "anual").reduce((t, f) => t + (Number(f.valor) || 0), 0);
  const cel = "border-b border-white/5 px-2 py-1.5 align-top";
  const inp = "w-full rounded bg-transparent px-1.5 py-1 text-xs text-white outline-none border border-transparent hover:border-white/10 focus:border-brand";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-[10px] uppercase tracking-widest text-brand-muted">Ferramentas hoje</p>
          <p className="mt-1 text-2xl font-bold text-white">{brl(totalHoje)}<span className="text-sm font-normal text-brand-muted">/mês</span></p>
          <p className="text-xs text-brand-muted">{lista.length} ferramentas · {brl(totalHoje * 12)}/ano</p>
          {avistaHoje > 0 && <p className="mt-1 text-[10px] text-brand-muted">inclui {brl(avistaHoje)}/ano pagos de uma vez (à vista)</p>}
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-[10px] uppercase tracking-widest text-brand-muted">Mantidas no cenário</p>
          <p className="mt-1 text-2xl font-bold text-white">{brl(totalDepois)}<span className="text-sm font-normal text-brand-muted">/mês</span></p>
          <p className="text-xs text-brand-muted">{lista.filter((f) => f.manter).length} ativas · {lista.filter((f) => !f.manter).length} canceladas</p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300">Economia</p>
          <p className="mt-1 text-2xl font-bold text-emerald-200">{brl(economia)}<span className="text-sm font-normal">/mês</span></p>
          <p className="text-xs text-emerald-300/80">{brl(economia * 12)}/ano{totalHoje ? ` · ${Math.round((economia / totalHoje) * 100)}% das ferramentas` : ""}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
        <table className="w-full min-w-[900px] text-xs">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-widest text-brand-muted">
              <th className="px-3 py-2">Nome da ferramenta</th>
              <th className="px-3 py-2">Quem usa</th>
              <th className="px-3 py-2">Valor pago (R$)</th>
              <th className="px-3 py-2">Forma de pagamento</th>
              <th className="px-3 py-2">Manter ativa</th>
              <th className="px-3 py-2">Observação</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id} className={f.manter ? "" : "bg-red-500/5"}>
                <td className={`${cel} w-[22%]`}>
                  <input className={`${inp} font-semibold ${f.manter ? "" : "line-through text-brand-muted"}`} defaultValue={f.nome} placeholder="ex: Reportei"
                    onBlur={(e) => { if (e.target.value.trim() !== f.nome) salvar(f.id, { nome: e.target.value.trim() }); }} />
                </td>
                <td className={`${cel} w-[11%]`}>
                  <select className={inp} value={f.quem_usa} onChange={(e) => salvar(f.id, { quem_usa: e.target.value as QuemUsa })}>
                    {QUEM_USA.map((q) => <option key={q.v} value={q.v} className="bg-brand-panel">{q.label}</option>)}
                  </select>
                </td>
                <td className={`${cel} w-[13%]`}>
                  <input type="number" step="0.01" className={inp} defaultValue={f.valor ?? ""} placeholder="0,00"
                    onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== f.valor) salvar(f.id, { valor: v }); }} />
                  {f.periodicidade !== "mensal" && f.valor ? (
                    <p className="px-1.5 text-[10px] text-brand-muted">
                      {f.periodicidade === "anual_12x" ? `total do ano · 12x de ${brl(mensalDe(f))}` : `total do ano, pago 1x · equivale a ${brl(mensalDe(f))}/mês`}
                    </p>
                  ) : null}
                </td>
                <td className={`${cel} w-[11%]`}>
                  <select className={inp} value={f.periodicidade} onChange={(e) => salvar(f.id, { periodicidade: e.target.value as Periodicidade })}>
                    {PERIODICIDADES.map((x) => <option key={x.v} value={x.v} className="bg-brand-panel">{x.label}</option>)}
                  </select>
                </td>
                <td className={`${cel} w-[10%]`}>
                  <div className="flex gap-1">
                    {([[true, "Sim"], [false, "Não"]] as const).map(([v, label]) => (
                      <button key={label} onClick={() => salvar(f.id, { manter: v })}
                        className={`rounded px-2 py-1 text-[10px] font-bold ${f.manter === v
                          ? v ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                          : "bg-white/5 text-brand-muted hover:text-white"}`}>{label}</button>
                    ))}
                  </div>
                </td>
                <td className={cel}>
                  <textarea rows={1} className={`${inp} resize-y`} defaultValue={f.observacao ?? ""} placeholder="—"
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== f.observacao) salvar(f.id, { observacao: v }); }} />
                </td>
                <td className={`${cel} w-8 text-right`}>
                  <button onClick={() => remover(f)} title="Excluir" className="text-red-300/70 hover:text-red-400">✕</button>
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-brand-muted">Nenhuma ferramenta ainda. Clique em &quot;+ Nova ferramenta&quot;.</td></tr>
            )}
          </tbody>
        </table>
        <div className="border-t border-white/5 p-3">
          <button className="btn text-xs" onClick={nova}>+ Nova ferramenta</button>
          <span className="ml-3 text-[10px] text-brand-muted">Tudo salva sozinho quando você sai do campo. Mensal: valor de cada mês. Anual (12x ou à vista): coloque o total do ano; na conta entra dividido por 12.</span>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// Resumo para a diretoria
// ======================================================================
function Resumo({ cenario, squads, todosSquads, pessoas, clientes, pessoaPorId, ind, onNotas, cadastro, onIncluir, onFolhaBase }: {
  cadastro: Cad[]; onIncluir: (r: Cad, squadId: string | null) => void; onFolhaBase: (v: number | null) => void;
  cenario: Cenario; squads: CSquad[]; todosSquads: CSquad[]; pessoas: CPessoa[]; clientes: CCliente[];
  pessoaPorId: Map<string, CPessoa>; ind: Ind; onNotas: (v: string) => void;
}) {
  const vagas = pessoas.filter((p) => p.status === "vaga");
  const nomeSquadOrig = (p: CPessoa) => todosSquads.find((s) => s.id === p.squad_original_id)?.nome ?? "—";
  // Ferramentas do cenário (migration 048): "Manter ativa = Não" vira redução de custo
  const [ferramentas, setFerramentas] = useState<Ferramenta[] | null>([]);
  useEffect(() => {
    createClient().from("ruston_cenario_ferramentas").select("*").eq("cenario_id", cenario.id)
      .then(({ data, error }) => setFerramentas(error ? null : (data as Ferramenta[]) ?? []));
  }, [cenario.id]);
  const ferrHoje = (ferramentas ?? []).reduce((t, f) => t + mensalDe(f), 0);
  const ferrDepois = (ferramentas ?? []).filter((f) => f.manter).reduce((t, f) => t + mensalDe(f), 0);
  const ferrCortadas = (ferramentas ?? []).filter((f) => !f.manter);
  const reducaoFolha = ind.folhaHoje - ind.folhaDepois;
  const reducaoFerr = ferrHoje - ferrDepois;
  const reducaoTotal = reducaoFolha + reducaoFerr;
  const gpsQueRecebem = new Map<string, CCliente[]>();
  ind.trocaGp.forEach((c) => { const k = c.gp_id ?? ""; gpsQueRecebem.set(k, [...(gpsQueRecebem.get(k) ?? []), c]); });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-white">Ruston Operações · antes × depois</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 p-4">
            <p className="text-[10px] uppercase tracking-widest text-brand-muted">Pessoas</p>
            <p className="mt-1 text-2xl font-bold text-white">{ind.hoje} <span className="text-brand-muted">→</span> {ind.depois}</p>
            <p className="text-xs text-brand-muted">{ind.hoje - ind.depois > 0 ? `${ind.hoje - ind.depois} a menos` : "sem redução"}{ind.hoje ? ` (${Math.round(((ind.hoje - ind.depois) / ind.hoje) * 100)}%)` : ""}</p>
          </div>
          <div className="rounded-xl border border-white/10 p-4">
            <p className="text-[10px] uppercase tracking-widest text-brand-muted">Folha mensal</p>
            <p className="mt-1 text-2xl font-bold text-white">{brlK(ind.folhaHoje)} <span className="text-brand-muted">→</span> {brlK(ind.folhaDepois)}</p>
            <p className="text-xs text-brand-muted">{brl(ind.folhaHoje)} → {brl(ind.folhaDepois)}</p>
            <p className="mt-1 text-[11px] text-brand-muted">
              − {brl(ind.folhaSaindo)} de {ind.saindo.length} saindo{ind.folhaVagas > 0 ? ` · + ${brl(ind.folhaVagas)} de vagas` : ""}
            </p>
            <label className="mt-2 flex items-center gap-2 text-[10px] text-brand-muted">
              Folha atual (base):
              <input key={`${cenario.id}-${ind.folhaBase ?? "x"}`} type="number" defaultValue={ind.folhaBase ?? ""}
                placeholder={`calculada ${Math.round(ind.folhaCalculada)}`}
                className="w-28 border-b border-white/10 bg-transparent text-white outline-none focus:border-brand"
                onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== ind.folhaBase) onFolhaBase(v); }} />
            </label>
          </div>
          <div className="rounded-xl border border-white/10 p-4">
            <p className="text-[10px] uppercase tracking-widest text-brand-muted">Ferramentas (mensal)</p>
            {ferramentas == null ? (
              <p className="mt-2 text-xs text-amber-300">Rode a migration 048 para somar as ferramentas.</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold text-white">{brlK(ferrHoje)} <span className="text-brand-muted">→</span> {brlK(ferrDepois)}</p>
                <p className="text-xs text-brand-muted">{brl(ferrHoje)} → {brl(ferrDepois)}</p>
                <p className="mt-1 text-[11px] text-brand-muted">
                  {ferrCortadas.length} cancelada{ferrCortadas.length === 1 ? "" : "s"}{ferrCortadas.length ? `: ${ferrCortadas.map((f) => f.nome || "sem nome").join(", ")}` : ""}
                </p>
              </>
            )}
          </div>
        </div>

        <h4 className="mb-2 mt-5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Redução de custo</h4>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {([
            ["Folha", reducaoFolha, ind.folhaHoje, "da folha"],
            ["Ferramentas", reducaoFerr, ferrHoje, "das ferramentas"],
          ] as const).map(([titulo, valor, baseHoje, deQue]) => (
            <div key={titulo} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-300">{titulo}</p>
              <p className="mt-1 text-2xl font-bold text-emerald-200">{brl(valor)}<span className="text-sm font-normal">/mês</span></p>
              <p className="text-xs text-emerald-300/80">{brl(valor * 12)}/ano{baseHoje ? ` · ${Math.round((valor / baseHoje) * 100)}% ${deQue}` : ""}</p>
            </div>
          ))}
          <div className="rounded-xl border-2 border-emerald-400/50 bg-emerald-500/15 p-4">
            <p className="text-[10px] uppercase tracking-widest text-emerald-200">Consolidado (folha + ferramentas)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-100">{brl(reducaoTotal)}<span className="text-sm font-normal">/mês</span></p>
            <p className="text-xs text-emerald-200/80">
              {brl(reducaoTotal * 12)}/ano{ind.folhaHoje + ferrHoje ? ` · ${Math.round((reducaoTotal / (ind.folhaHoje + ferrHoje)) * 100)}% do custo (${brlK(ind.folhaHoje + ferrHoje)} → ${brlK(ind.folhaDepois + ferrDepois)})` : ""}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-brand-muted">
          {ind.mrrTotal ? <>Folha sobre o MRR da base ({brl(ind.mrrTotal)}): {Math.round((ind.folhaHoje / ind.mrrTotal) * 100)}% → <strong className="text-white">{Math.round((ind.folhaDepois / ind.mrrTotal) * 100)}%</strong>. </> : null}
          {ind.folhaBase != null
            ? "Folha atual informada; o depois desconta automaticamente o salário (cadastro de Pessoas) de quem está marcado “Sai” e soma as vagas."
            : "Salário de cada pessoa vem do cadastro de Pessoas; vagas entram pelo valor estimado no cenário."}
        </p>
        {ind.semSalario.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-300">
            ⚠️ Sem salário ({ind.semSalario.length}), fora da conta: {ind.semSalario.map((p) => p.nome).join(", ")}. Preencha em Pessoas ou clicando na pessoa no organograma.
          </p>
        )}
        <ConferenciaFolha pessoas={pessoas} cadastro={cadastro} ind={ind} onIncluir={onIncluir} squads={squads} />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-white">Desligamentos ({ind.saindo.length}{cenario.meta_saidas != null ? ` de ${cenario.meta_saidas}` : ""})</h3>
          {ind.saindo.length === 0 && <p className="text-xs text-brand-muted">Ninguém marcado como “Sai” ainda.</p>}
          <ul className="space-y-1.5 text-xs">
            {ind.saindo.map((p) => {
              const qtd = clientes.filter((c) => c.gp_original_id === p.id || c.gt_original_id === p.id || c.designer_original_id === p.id).length;
              return (
                <li key={p.id} className="flex justify-between gap-2 border-b border-white/5 pb-1.5">
                  <span><strong className="text-white">{p.nome}</strong> <span className="text-brand-muted">· {PAPEL_LABEL[p.papel]} · {nomeSquadOrig(p)}</span>
                    {p.nota && <span className="block text-[10px] italic text-amber-200/80">{p.nota}</span>}</span>
                  <span className="whitespace-nowrap text-brand-muted">{qtd} clientes{ind.salarioDe(p) != null && <> · {brl(ind.salarioDe(p)!)}</>}</span>
                </li>
              );
            })}
          </ul>
          {vagas.length > 0 && (
            <>
              <h4 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-widest text-sky-300">Vagas no cenário ({vagas.length})</h4>
              <ul className="space-y-1 text-xs">{vagas.map((v) => <li key={v.id}>{v.nome} <span className="text-brand-muted">· {PAPEL_LABEL[v.papel]}</span></li>)}</ul>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white">Impacto no cliente</h3>
          <p className="mb-3 text-[11px] text-brand-muted">
            {ind.trocaGp.length} clientes trocam de GP ({brl(ind.mrrTrocaGp)} de MRR, {ind.mrrTotal ? Math.round((ind.mrrTrocaGp / ind.mrrTotal) * 100) : 0}% da base) · {ind.vermelhosTrocaGp} estão vermelhos no FCA · {ind.trocaGt.length} trocam só de GT e {ind.trocaDg.length} de designer.
          </p>
          {Array.from(gpsQueRecebem.entries()).map(([gpId, lista]) => (
            <div key={gpId} className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-300">
                {gpId ? pessoaPorId.get(gpId)?.nome : "Ainda sem GP"} recebe {lista.length}
              </p>
              <p className="text-[11px] text-brand-muted">
                {lista.map((c) => `${c.nome}${c.bandeira === "vermelho" ? " 🔴" : ""}`).join(" · ")}
              </p>
            </div>
          ))}
          {ind.trocaGp.length === 0 && <p className="text-xs text-brand-muted">Nenhum cliente troca de GP neste cenário.</p>}
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-white">Notas para a apresentação</h3>
        <textarea key={cenario.id} defaultValue={cenario.notas ?? ""} onBlur={(e) => onNotas(e.target.value)}
          placeholder="Racional, riscos, plano de comunicação com os clientes, prazos..."
          className="input min-h-[140px] text-sm" />
        <p className="mt-1 text-[10px] text-brand-muted">Salva quando você clica fora da caixa.</p>
      </section>
    </div>
  );
}

// Conferência: cadastro de Pessoas (ativos com salário) × quem está no cenário
function ConferenciaFolha({ pessoas, cadastro, ind, onIncluir, squads }: { pessoas: CPessoa[]; cadastro: Cad[]; ind: Ind; onIncluir: (r: Cad, squadId: string | null) => void; squads: CSquad[] }) {
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState<Record<string, string>>({});
  const noCenario = new Set(pessoas.map((p) => p.origem_pessoa_id).filter(Boolean) as string[]);
  const ativos = cadastro.filter((r) => r.ativo);
  const totalCadastro = ativos.reduce((t, r) => t + (Number(r.salario) || 0), 0);
  const fora = ativos.filter((r) => !noCenario.has(r.id)).sort((a, b) => (Number(b.salario) || 0) - (Number(a.salario) || 0));
  const semCadastro = pessoas.filter((p) => !p.origem_pessoa_id && p.status !== "vaga");
  const linhasCenario = pessoas
    .filter((p) => (p.origem_pessoa_id || p.squad_original_id) && p.status !== "vaga")
    .map((p) => ({ p, v: ind.salarioDe(p) }))
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
  return (
    <div className="mt-4 rounded-xl border border-white/10 p-3">
      <button onClick={() => setAberto(!aberto)} className="flex w-full items-center justify-between text-left text-xs">
        <span className="font-semibold text-white">🔎 Conferência da folha</span>
        <span className="text-brand-muted">
          cadastro ativo {brl(totalCadastro)} ({ativos.length} pessoas) · no cenário hoje {brl(ind.folhaHoje)} ({ind.hoje})
          {fora.length > 0 && <span className="text-amber-300"> · {fora.length} do cadastro fora do cenário</span>}
          {" "}{aberto ? "▲" : "▼"}
        </span>
      </button>
      {aberto && (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3 text-[11px]">
          <div>
            <p className="mb-1 font-semibold uppercase tracking-widest text-amber-300">No cadastro, fora do cenário ({fora.length})</p>
            <p className="mb-2 text-brand-muted">Ativos em Pessoas que não entraram no cenário. Se fazem parte da operação, inclua.</p>
            <ul className="space-y-1">
              {fora.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1">
                  <span><strong className="text-white">{r.nome}</strong> <span className="text-brand-muted">· {r.cargo ?? "—"}{r.compartilhado_entre_squads ? " · compartilhado" : ""}</span></span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {r.salario != null ? brl(Number(r.salario)) : "sem salário"}
                    <select value={destino[r.id] ?? ""} onChange={(e) => setDestino({ ...destino, [r.id]: e.target.value })}
                      className="max-w-[110px] rounded border border-white/10 bg-transparent text-[10px] text-brand-muted">
                      <option value="">sem squad</option>
                      {squads.map((q) => <option key={q.id} value={q.id}>{q.nome}</option>)}
                    </select>
                    <button onClick={() => onIncluir(r, destino[r.id] || null)} className="text-sky-300 hover:text-sky-200">+ incluir</button>
                  </span>
                </li>
              ))}
              {fora.length === 0 && <li className="text-brand-muted">Ninguém.</li>}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-semibold uppercase tracking-widest text-amber-300">No cenário sem ligação com o cadastro ({semCadastro.length})</p>
            <p className="mb-2 text-brand-muted">Vieram do organograma, mas o nome não bateu com ninguém em Pessoas, então entram sem salário. Exclua e inclua pela lista ao lado.</p>
            <ul className="space-y-1">
              {semCadastro.map((p) => <li key={p.id} className="border-b border-white/5 pb-1"><strong className="text-white">{p.nome}</strong> <span className="text-brand-muted">· {p.cargo ?? PAPEL_LABEL[p.papel]}</span></li>)}
              {semCadastro.length === 0 && <li className="text-brand-muted">Ninguém.</li>}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-semibold uppercase tracking-widest text-white">Quem compõe a folha de hoje ({linhasCenario.length})</p>
            <ul className="space-y-1">
              {linhasCenario.map(({ p, v }) => (
                <li key={p.id} className="flex justify-between gap-2 border-b border-white/5 pb-1">
                  <span className={p.status === "sai" ? "text-red-300" : "text-white"}>{p.nome}{p.status === "sai" ? " (sai)" : ""}</span>
                  <span className={v == null ? "text-amber-300" : "text-brand-muted"}>{v != null ? brl(v) : "sem salário"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
