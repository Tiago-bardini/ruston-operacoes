"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UsuarioPerfil, PerfilUsuario } from "@/lib/types";

/**
 * Hook que retorna o perfil do usuário logado.
 * Busca em ruston_usuario_perfil pelo email do usuário autenticado.
 * Se não encontrar, retorna default: perfil = 'investidor' (mais restritivo).
 */
export function useUsuarioPerfil() {
  const supabase = createClient();
  const [perfil, setPerfil] = useState<UsuarioPerfil | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setLoading(false);
        return;
      }
      setEmail(user.email);
      const { data } = await supabase
        .from("ruston_usuario_perfil")
        .select("*")
        .eq("email", user.email)
        .maybeSingle();
      setPerfil(data as UsuarioPerfil | null);
      setLoading(false);
    })();
  // eslint-disable-next-line
  }, []);

  const p: PerfilUsuario = perfil?.perfil ?? "investidor";
  return {
    loading,
    email,
    perfil,
    tipo: p,
    isGerente: p === "gerente",
    isCoordenador: p === "coordenador",
    isInvestidor: p === "investidor",
    squadId: perfil?.squad_id ?? null,
    pessoaId: perfil?.pessoa_id ?? null,
    // Convenções úteis
    // Financeiro (Headcount, Forecast, Salários) = Gerente + Coordenador
    podeVerFinanceiro: p === "gerente" || p === "coordenador",
    podeVerSalario:    p === "gerente" || p === "coordenador",
    podeVerHeadcount:  p === "gerente" || p === "coordenador",
    podeVerForecast:   p === "gerente" || p === "coordenador",
    // EDIÇÃO — só Gerente e Coordenador podem editar/excluir Pessoas, Squads, Metas
    // Investidor tem acesso APENAS DE LEITURA
    podeEditar: p === "gerente" || p === "coordenador",
    // Gerente vê tudo (global). Coordenador só vê o próprio squad
    escopo: p === "gerente" ? "global" : "squad" as "global" | "squad",
    // Só Gerente pode gerenciar perfis de acesso
    podeGerenciarUsuarios: p === "gerente",
  };
}
