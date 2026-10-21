"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { PERFIL_LABEL } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  soGerente?: boolean;
  soGerenteCoord?: boolean;
};

type NavGroup = { label: string; icon: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Início", icon: "🏠", items: [
      { href: "/painel-gerente", label: "Painel Gerente", icon: "◈", soGerente: true },
      { href: "/cockpit", label: "Cockpit", icon: "★" },
    ],
  },
  {
    label: "Clientes", icon: "◎", items: [
      { href: "/clientes", label: "Carteira", icon: "◎" },
      { href: "/churn", label: "Churn", icon: "↘" },
      { href: "/reunioes", label: "Reuniões", icon: "☎" },
      { href: "/entregas", label: "Entregas", icon: "✎" },
    ],
  },
  {
    label: "Saúde da Carteira", icon: "♥", items: [
      { href: "/health-score", label: "Health Score", icon: "♥", soGerenteCoord: true },
      { href: "/sla", label: "Controle SLA", icon: "⏱", soGerenteCoord: true },
      { href: "/radar-whatsapp", label: "Radar WhatsApp", icon: "📱", soGerenteCoord: true },
      { href: "/fca", label: "FCA", icon: "▤" },
    ],
  },
  {
    label: "Receita", icon: "💰", items: [
      { href: "/monetizacao", label: "Monetização", icon: "💰" },
      { href: "/forecast", label: "Forecast", icon: "↗", soGerenteCoord: true },
      { href: "/metas", label: "Metas", icon: "◈" },
    ],
  },
  {
    label: "Operação", icon: "⚡", items: [
      { href: "/ekyte", label: "Ekyte", icon: "📊" },
      { href: "/produtividade", label: "Produtividade", icon: "⚡", soGerenteCoord: true },
    ],
  },
  {
    label: "Time", icon: "👥", items: [
      { href: "/pessoas", label: "Pessoas", icon: "◆" },
      { href: "/squads", label: "Squads", icon: "◇" },
      { href: "/organograma", label: "Organograma", icon: "👥" },
      { href: "/headcount", label: "Headcount", icon: "☰", soGerenteCoord: true },
    ],
  },
  {
    label: "Comercial", icon: "🔍", items: [
      { href: "/auditoria-vendas", label: "Auditoria de Vendas", icon: "🔍", soGerenteCoord: true },
      { href: "/analise-reunioes", label: "Análise Reuniões IA", icon: "🎙", soGerenteCoord: true },
    ],
  },
];

const STORAGE_KEY = "ruston_sidebar_abertos";

export default function Sidebar({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { tipo, isGerente, isCoordenador } = useUsuarioPerfil();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function permitido(it: NavItem) {
    if (it.soGerente && !isGerente) return false;
    if (it.soGerenteCoord && !(isGerente || isCoordenador)) return false;
    return true;
  }

  const grupos = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter(permitido) }))
    .filter((g) => g.items.length > 0);

  // Grupos abertos: lembra a escolha do usuário e sempre abre o grupo da página atual
  const [abertos, setAbertos] = useState<string[]>([]);
  useEffect(() => {
    let salvos: string[] = [];
    try { salvos = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch {}
    setAbertos(salvos);
  }, []);
  useEffect(() => {
    const atual = NAV_GROUPS.find((g) => g.items.some((it) => pathname.startsWith(it.href)));
    if (atual) setAbertos((a) => (a.includes(atual.label) ? a : [...a, atual.label]));
  }, [pathname]);

  function alternar(label: string) {
    setAbertos((a) => {
      const novo = a.includes(label) ? a.filter((x) => x !== label) : [...a, label];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(novo)); } catch {}
      return novo;
    });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-brand-panel/50 p-4">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-black">R</div>
        <div className="leading-tight">
          <p className="text-sm font-bold">Ruston Operações</p>
          <p className="text-[10px] text-brand-muted">Painel interno</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {grupos.map((g) => {
          const aberto = abertos.includes(g.label);
          const grupoAtivo = g.items.some((it) => pathname.startsWith(it.href));
          return (
            <div key={g.label}>
              <button
                onClick={() => alternar(g.label)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  grupoAtivo ? "text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <span className="w-4 text-center">{g.icon}</span>
                <span className="flex-1 text-left">{g.label}</span>
                <span className={`text-[10px] text-brand-muted transition ${aberto ? "rotate-90" : ""}`}>▶</span>
              </button>
              {aberto && (
                <div className="mb-1 ml-5 space-y-0.5 border-l border-white/5 pl-2">
                  {g.items.map((item) => {
                    const active = pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                          active ? "bg-brand/15 text-white" : "text-brand-muted hover:bg-white/5 hover:text-gray-200"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="mt-4 border-t border-white/5 pt-4">
        {email && (
          <p className="mb-1 truncate px-2 text-xs text-brand-muted" title={email}>
            {email}
          </p>
        )}
        <p className="mb-2 px-2 text-[10px] text-brand">
          Perfil: {PERFIL_LABEL[tipo]}
        </p>
        <div className="flex gap-2">
          {isGerente && (
            <Link
              href="/usuarios"
              title="Gestão de Usuários"
              className={`btn-ghost px-3 text-xs ${pathname.startsWith("/usuarios") ? "border-brand text-white" : ""}`}
            >⚿</Link>
          )}
          <button onClick={signOut} className="btn-ghost flex-1 text-xs">Sair</button>
        </div>
      </div>
    </aside>
  );
}
