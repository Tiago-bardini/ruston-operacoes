import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { podeAcessar, rotaRestrita } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path.startsWith("/_next") || path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/clientes";
    return NextResponse.redirect(url);
  }

  if (user && !isPublic) {
    const { data } = await supabase
      .from("ruston_usuario_perfil")
      .select("perfil, ativo")
      .ilike("email", user.email ?? "") // sem diferenciar maiúscula, igual ao banco
      .maybeSingle();

    // Só entra quem está ativo na Gestão de Usuários (e-mail V4 sozinho não basta)
    if (!data || data.ativo === false) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?erro=sem_acesso";
      const redirect = NextResponse.redirect(url);
      // Leva junto os cookies de sessão já limpos pelo signOut
      supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }

    // Página restrita por perfil: bloqueia também o acesso direto pela URL
    if (rotaRestrita(path) && !podeAcessar(path, data.perfil as PerfilUsuario)) {
      const url = request.nextUrl.clone();
      url.pathname = "/acesso-negado";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
