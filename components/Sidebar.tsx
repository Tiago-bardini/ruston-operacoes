"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

const NAV_ACTIVE: NavItem[] = [
  { href: "/painel-gerente", label: "Painel Gerente", icon: "◈", soGerente: true },
  { href: "/cockpit", label: "Cockpit", icon: "★" },
  { href: "/health-score", label: "Health Score", icon: "♥", soGerenteCoord: true },
  { href: "/clientes", label: "Clientes", icon: "◎" },
  { href: "/entregas", label: "Entregas", icon: "✎" },
  { href: "/monetizacao", label: "Monetização", icon: "💰" },
  { href: "/pessoas", label: "Pessoas", icon: "◆" },
  { href: "/squads", label: "Squads", icon: "◇" },
  { href: "/organograma", label: "Organograma", icon: "👥" },
  { href: "/metas", label: "Metas", icon: "◈" },
  { href: "/fca", label: "FCA", icon: "▤" },
  { href: "/ekyte", label: "Ekyte", icon: "📊" },
  { href: "/produtividade", label: "Produtividade", icon: "⚡", soGerenteCoord: true },
  { href: "/sla", label: "Controle SLA", icon: "⏱", soGerenteCoord: true },
  { href: "/radar-whatsapp", label: "Radar WhatsApp", icon: "📱", soGerenteCoord: true },
  { href: "/headcount", label: "Headcount", icon: "☰", soGerenteCoord: true },
  { href: "/forecast", label: "Forecast", icon: "↗", soGerenteCoord: true },
  { href: "/reunioes", label: "Reuniões", icon: "☎" },
  { href: "/analise-reunioes", label: "Analise Reunioes IA", icon: "🎙", soGerenteCoord: true },
  { href: "/usuarios", label: "Usuários", icon: "⚿", soGerente: true },
];


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

  const items = NAV_ACTIVE.filter((it) => {
    if (it.soGerente && !isGerente) return false;
    if (it.soGerenteCoord && !(isGerente || isCoordenador)) return false;
    return true;
  });

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-brand-panel/50 p-4">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-black">R</div>
        <div className="leading-tight">
          <p className="text-sm font-bold">Ruston Operações</p>
          <p className="text-[10px] text-brand-muted">Painel interno</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active ? "bg-brand/15 text-white" : "text-brand-muted hover:bg-white/5 hover:text-gray-200"
              }`}
            >
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
            </Link>
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
        <button onClick={signOut} className="btn-ghost w-full text-xs">Sair</button>
      </div>
    </aside>
  );
}
