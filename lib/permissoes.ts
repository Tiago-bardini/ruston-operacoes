import type { PerfilUsuario } from "@/lib/types";

// Fonte única de quem acessa o quê. Usada pelo menu (Sidebar) e pelo middleware,
// que bloqueia o acesso direto pela URL. Rota fora da lista = todos os perfis,
// exceto o Gestor de Projetos, que só entra nas telas de GESTOR_ROTAS.
export const ROTAS_RESTRITAS: { prefixo: string; perfis: PerfilUsuario[] }[] = [
  { prefixo: "/painel-gerente", perfis: ["gerente"] },
  { prefixo: "/projecao", perfis: ["gerente"] },
  { prefixo: "/cockpit", perfis: ["gerente", "coordenador"] },
  { prefixo: "/usuarios", perfis: ["gerente"] },
  { prefixo: "/log-alteracoes", perfis: ["gerente"] },
  { prefixo: "/health-score", perfis: ["gerente", "coordenador", "investidor", "gestor_projetos"] },
  { prefixo: "/playbook-nps", perfis: ["gerente", "coordenador", "gestor_projetos"] },
  { prefixo: "/sla", perfis: ["gerente", "coordenador", "gestor_projetos"] },
  { prefixo: "/radar-whatsapp", perfis: ["gerente", "coordenador", "gestor_projetos"] },
  { prefixo: "/forecast", perfis: ["gerente", "coordenador"] },
  { prefixo: "/produtividade", perfis: ["gerente", "coordenador"] },
  { prefixo: "/headcount", perfis: ["gerente", "coordenador"] },
  { prefixo: "/placar", perfis: ["gerente", "coordenador"] },
  { prefixo: "/auditoria-vendas", perfis: ["gerente", "coordenador"] },
  { prefixo: "/analise-reunioes", perfis: ["gerente", "coordenador"] },
  { prefixo: "/conferencia-ee", perfis: ["gerente", "coordenador", "gestor_projetos"] },
];

/** Telas do Gestor de Projetos (o ROI do cliente fica dentro do Planejamento). */
export const GESTOR_ROTAS = [
  "/clientes", "/planejamento", "/churn", "/conferencia-ee",
  "/health-score", "/sla", "/radar-whatsapp", "/fca", "/pesquisas", "/playbook-nps",
  "/monetizacao", "/conexao-ia",
];
// Caminhos fora do menu que todo logado usa
const SEMPRE_LIBERADAS = ["/", "/acesso-negado", "/login"];

const casa = (path: string, prefixo: string) => path === prefixo || path.startsWith(prefixo + "/");

export function podeAcessar(path: string, perfil: PerfilUsuario): boolean {
  if (SEMPRE_LIBERADAS.includes(path) || path.startsWith("/p/")) return true;
  if (perfil === "gestor_projetos" && !GESTOR_ROTAS.some((p) => casa(path, p))) return false;
  const regra = ROTAS_RESTRITAS.find((r) => casa(path, r.prefixo));
  return !regra || regra.perfis.includes(perfil);
}
