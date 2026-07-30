export type Cargo =
  | "coordenador"
  | "gestor_projetos"
  | "gestor_trafego"
  | "designer"
  | "social_media"
  | "copy"
  | "gerente"
  | "coo"
  | "tech"
  | "outro";

export const CARGO_LABEL: Record<Cargo, string> = {
  coordenador: "Coordenador",
  gestor_projetos: "Gestor de Projetos",
  gestor_trafego: "Gestor de Tráfego",
  designer: "Designer",
  social_media: "Social Media",
  copy: "Copy",
  gerente: "Gerente",
  coo: "COO",
  tech: "TECH",
  outro: "Outro",
};

export type EtapaCliente =
  | "onboarding"
  | "estruturacao_estrategica"
  | "byline"
  | "em_recuperacao"
  | "suspenso"
  | "cancelado";

export const ETAPA_LABEL: Record<EtapaCliente, string> = {
  onboarding: "Onboarding",
  estruturacao_estrategica: "Estruturação Estratégica",
  byline: "By-line",
  em_recuperacao: "Em Recuperação",
  suspenso: "Suspenso",
  cancelado: "Cancelado",
};

export const ETAPA_COLOR: Record<EtapaCliente, string> = {
  onboarding: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  estruturacao_estrategica: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  byline: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  em_recuperacao: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  suspenso: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  cancelado: "bg-red-500/20 text-red-300 border-red-500/30",
};

export type TierCliente = "tiny" | "small" | "medium" | "large";

export const TIER_LABEL: Record<TierCliente, string> = {
  tiny: "TINY",
  small: "SMALL",
  medium: "MEDIUM",
  large: "LARGE",
};

export interface Squad {
  id: string;
  nome: string;
  label: string | null;
  cor: string | null;
  logo_url: string | null;
  coordenador_id: string | null;
  ativo: boolean;
  incluir_em_comparativo: boolean;
  created_at: string;
}

export type NivelSenioridade = "junior" | "pleno" | "senior" | "especialista";
export type VersaoV = "v1" | "v2" | "v3" | "v4";

export const NIVEL_LABEL: Record<NivelSenioridade, string> = {
  junior: "Junior",
  pleno: "Pleno",
  senior: "Sênior",
  especialista: "Especialista",
};

export const V_LABEL: Record<VersaoV, string> = {
  v1: "V1",
  v2: "V2",
  v3: "V3",
  v4: "V4",
};

export interface Pessoa {
  id: string;
  nome: string;
  email: string | null;
  cargo: Cargo;
  squad_id: string | null;
  foto_url: string | null;
  ativo: boolean;
  observacoes: string | null;
  nivel_senioridade: NivelSenioridade | null;
  nivel_v: VersaoV | null;
  salario: number | null;
  compartilhado_entre_squads: boolean;
  created_at: string;
  updated_at: string;
}

export interface HeadcountPlanejado {
  id: string;
  squad_id: string;
  cargo: Cargo;
  quantidade_planejada: number;
  created_at: string;
  updated_at: string;
}

export type TipoCadencia = "semanal" | "quinzenal" | "mensal" | "custom";
export type TipoReuniao = "kickoff" | "periodica" | "urgente" | "upsell" | "renovacao" | "outra";

export const TIPO_CADENCIA_LABEL: Record<TipoCadencia, string> = {
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
  custom: "Custom",
};

export const TIPO_REUNIAO_LABEL: Record<TipoReuniao, string> = {
  kickoff: "Kickoff",
  periodica: "Periódica",
  urgente: "Urgente",
  upsell: "Upsell",
  renovacao: "Renovação",
  outra: "Outra",
};

export interface ReuniaoCliente {
  id: string;
  cliente_id: string;
  data_reuniao: string;
  hora: string | null;
  tipo_reuniao: TipoReuniao;
  responsavel_id: string | null;
  presentes: string | null;
  resumo: string | null;
  decisoes: string | null;
  proximos_passos: string | null;
  observacoes: string | null;
  realizada: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReuniaoStatus {
  cliente_id: string;
  cliente_nome: string;
  cliente_squad_id: string | null;
  cliente_account_id: string | null;
  cadencia_dias: number;
  tipo_cadencia: TipoCadencia;
  ultima_reuniao: string | null;
  total_reunioes: number;
  dias_sem_reuniao: number;
}

export function statusCadencia(status: ReuniaoStatus): "ok" | "proximo" | "atrasado" | "critico" {
  if (status.ultima_reuniao == null) return "critico";
  const dias = status.dias_sem_reuniao;
  const cad = status.cadencia_dias;
  if (dias >= cad * 1.5) return "critico";
  if (dias >= cad) return "atrasado";
  if (dias >= cad * 0.75) return "proximo";
  return "ok";
}

export const STATUS_CADENCIA_COLOR = {
  ok:       "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  proximo:  "bg-sky-500/20 text-sky-300 border-sky-500/40",
  atrasado: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  critico:  "bg-red-500/20 text-red-300 border-red-500/40",
};

export const STATUS_CADENCIA_LABEL = {
  ok: "Em dia",
  proximo: "Se aproximando",
  atrasado: "Atrasado",
  critico: "Crítico",
};

export interface Forecast {
  id: string;
  ano: number;
  mes: number;
  meta_mrr: number | null;
  churn_projetado_pct: number;
  novos_contratos_valor: number;
  mrr_realizado: number | null;
  observacoes: string | null;
  // Projetado
  mrr_aquisicao_projetado: number;
  onetime_aquisicao_projetado: number;
  mrr_upsell_projetado: number;
  onetime_upsell_projetado: number;
  clientes_churn_projetado: number;
  // Realizado editável
  mrr_aquisicao_realizado: number | null;
  onetime_aquisicao_realizado: number | null;
  mrr_upsell_realizado: number | null;
  onetime_upsell_realizado: number | null;
  clientes_churn_realizado: number | null;
  // Fechamento
  fechado: boolean;
  fechado_em: string | null;
  mrr_total_snapshot: number | null;
  clientes_ativos_snapshot: number | null;
  total_pessoas_snapshot: number | null;
  folha_snapshot: number | null;
  created_at: string;
  updated_at: string;
}

export type UnidadeMeta = "percentual" | "nota" | "reais" | "quantidade";

export const UNIDADE_LABEL: Record<UnidadeMeta, string> = {
  percentual: "%",
  nota: "nota",
  reais: "R$",
  quantidade: "qtde",
};

export interface MetaEmpresa {
  id: string;
  ano: number;
  mes: number;
  metrica: string;
  metrica_label: string;
  unidade: UnidadeMeta;
  valor_meta: number;
  valor_realizado: number | null;
  observacoes: string | null;
  responsavel_id: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
}

export interface MetaSquad extends MetaEmpresa {
  squad_id: string;
}

export function formatMeta(valor: number | null | undefined, unidade: UnidadeMeta): string {
  if (valor == null) return "—";
  if (unidade === "percentual") return `${valor}%`;
  if (unidade === "reais") return formatBRL(valor);
  if (unidade === "nota") return String(valor);
  return String(valor);
}

export const MESES_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/* ================= FCA (Fato-Causa-Ação) ================= */

export type StatusFca = "rascunho" | "aguardando_validacao" | "validado";

export const STATUS_FCA_LABEL: Record<StatusFca, string> = {
  rascunho: "Rascunho",
  aguardando_validacao: "Aguardando validação",
  validado: "Validado",
};

export const STATUS_FCA_COLOR: Record<StatusFca, string> = {
  rascunho: "bg-white/5 text-brand-muted border-white/10",
  aguardando_validacao: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  validado: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export type BandeiraFca = "verde" | "amarelo" | "vermelho" | "sem_dado";

export const BANDEIRA_FCA_LABEL: Record<BandeiraFca, string> = {
  verde: "Verde",
  amarelo: "Amarelo",
  vermelho: "Vermelho",
  sem_dado: "Sem dado",
};

export const BANDEIRA_FCA_COLOR: Record<BandeiraFca, string> = {
  verde: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  amarelo: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  vermelho: "bg-red-500/20 text-red-300 border-red-500/40",
  sem_dado: "bg-white/5 text-brand-muted border-white/10",
};

export interface FcaAvaliacao {
  id: string;
  cliente_id: string;
  ano: number;
  mes: number;
  nota_resultado: number | null;
  nota_operacao_trafego: number | null;
  nota_prazo: number | null;
  nota_qualidade: number | null;
  nota_relacionamento: number | null;
  nota_roi: number | null;
  fato: string | null;
  causa: string | null;
  acao: string | null;
  status: StatusFca;
  preenchido_por_id: string | null;
  validado_por_id: string | null;
  validado_at: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FcaView extends FcaAvaliacao {
  nota_final: number | null;
  bandeira: BandeiraFca;
  cliente_nome: string;
  cliente_squad_id: string | null;
  cliente_account_id: string | null;
  preenchido_por_nome: string | null;
  validado_por_nome: string | null;
}

export const CRITERIOS_FCA = [
  { chave: "nota_resultado",        label: "Resultado",           peso: 7 },
  { chave: "nota_operacao_trafego", label: "Operação de Tráfego", peso: 5 },
  { chave: "nota_prazo",            label: "Prazo",               peso: 5 },
  { chave: "nota_qualidade",        label: "Qualidade",           peso: 4 },
  { chave: "nota_relacionamento",   label: "Relacionamento",      peso: 4 },
  { chave: "nota_roi",              label: "ROI",                 peso: 8 },
] as const;

export function calcularNotaFinalFca(f: Partial<FcaAvaliacao>): number | null {
  const notas = [
    f.nota_resultado,
    f.nota_operacao_trafego,
    f.nota_prazo,
    f.nota_qualidade,
    f.nota_relacionamento,
    f.nota_roi,
  ];
  if (notas.some((n) => n == null)) return null;
  const soma =
    (f.nota_resultado ?? 0) * 7 +
    (f.nota_operacao_trafego ?? 0) * 5 +
    (f.nota_prazo ?? 0) * 5 +
    (f.nota_qualidade ?? 0) * 4 +
    (f.nota_relacionamento ?? 0) * 4 +
    (f.nota_roi ?? 0) * 8;
  return Math.round((soma / 33) * 100) / 100;
}

export function bandeiraDaNota(nota: number | null): BandeiraFca {
  if (nota == null) return "sem_dado";
  if (nota >= 8) return "verde";
  if (nota >= 6) return "amarelo";
  return "vermelho";
}

export interface Cliente {
  id: string;
  codigo_interno: string | null;
  nome: string;
  etapa: EtapaCliente;
  mrr: number;
  fee: number | null;
  tier: TierCliente | null;
  data_assinatura: string | null;
  data_ultima_alteracao_fee: string | null;
  data_churn: string | null;
  contrato_url: string | null;
  prazo_contrato_meses: number | null;
  data_vencimento_contrato: string | null;
  churn_realizado: boolean;
  motivo_churn: string | null;
  data_subir_churn_sistema: string | null;
  subiu_no_sistema: boolean;
  subiu_no_sistema_em: string | null;
  coordenador_id: string | null;
  account_id: string | null;
  gestor_trafego_id: string | null;
  designer_id: string | null;
  squad_id: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ClienteView extends Cliente {
  lt_meses: number | null;
  coordenador_nome: string | null;
  account_nome: string | null;
  gestor_trafego_nome: string | null;
  designer_nome: string | null;
  squad_nome: string | null;
}

export function formatBRL(value: number | null | undefined): string {
  if (value == null) return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

/** Status de vencimento do contrato — usado pra colorir badges e alertas */
export type StatusVencimento = "vencido" | "critico" | "atencao" | "ok" | "sem_data";

export function statusVencimento(dataVencimento: string | null | undefined): StatusVencimento {
  if (!dataVencimento) return "sem_data";
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(dataVencimento + "T00:00:00");
  const diasRestantes = Math.floor((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  if (diasRestantes < 0) return "vencido";
  if (diasRestantes <= 30) return "critico";
  if (diasRestantes <= 60) return "atencao";
  return "ok";
}

export function diasParaVencimento(dataVencimento: string | null | undefined): number | null {
  if (!dataVencimento) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(dataVencimento + "T00:00:00");
  return Math.floor((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

export const STATUS_VENCIMENTO_LABEL: Record<StatusVencimento, string> = {
  vencido: "Vencido",
  critico: "Crítico (≤30 dias)",
  atencao: "Atenção (≤60 dias)",
  ok: "OK",
  sem_data: "Sem data",
};

export const STATUS_VENCIMENTO_COLOR: Record<StatusVencimento, string> = {
  vencido:  "bg-red-500/20 text-red-300 border-red-500/40",
  critico:  "bg-orange-500/20 text-orange-300 border-orange-500/40",
  atencao:  "bg-amber-500/20 text-amber-300 border-amber-500/40",
  ok:       "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  sem_data: "bg-white/5 text-brand-muted border-white/10",
};
