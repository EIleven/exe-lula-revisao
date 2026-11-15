// src/app/api/auth/session/route.ts
// Sessão de servidor, para a mídia privada poder ser servida por rota autenticada.
//
// POR QUE ISTO EXISTE: anexo de mensagem precisa aparecer num `<img>`, num `<video>` com busca de posição e num link
// de download. Nenhum desses elementos manda cabeçalho `Authorization`, então o Bearer token que o resto da API usa
// não serve aqui. Um cookie de sessão viaja sozinho, só para o nosso domínio, e permite ao navegador fazer o pedido
// com `Range` nativo — que é o que faz vídeo e áudio funcionarem de verdade.
//
// O NOME DO COOKIE NÃO É ESCOLHA: `__session` é o único que o Firebase Hosting e o App Hosting repassam ao backend.
// Qualquer outro nome é removido pela CDN antes de chegar aqui, e a rota de mídia privada responderia 404 para todo
// mundo. Não renomear.
import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export const SESSION_COOKIE = '__session';

/** Cinco dias. O máximo que o Firebase aceita é 14; menos tempo significa mais trocas de cookie sem ganho real. */
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

const LIMITE_POR_IP = 30;
const JANELA_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!takeRateLimit(`session:${requestIp(request)}`, LIMITE_POR_IP, JANELA_MS)) {
    return NextResponse.json({ error: 'too-many-requests' }, { status: 429 });
  }

  const corpo = await request.json().catch(() => null);
  const idToken = typeof corpo?.idToken === 'string' ? corpo.idToken : '';
  if (!idToken || idToken.length > 4096) {
    return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
  }

  try {
    // Confere o token antes de trocar por cookie. `checkRevoked` aqui recusa token de conta já desativada.
    await adminAuth().verifyIdToken(idToken, true);
    const sessionCookie = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE,
      value: sessionCookie,
      maxAge: SESSION_MAX_AGE_MS / 1000,
      httpOnly: true, // fora do alcance de JavaScript: um XSS não leva a sessão embora
      secure: true,
      // `strict` de propósito: o cookie não acompanha requisição vinda de outro site, então outra página não
      // consegue fazer o navegador buscar a mídia privada de quem está logado aqui.
      sameSite: 'strict',
      path: '/',
      // Sem `domain`: o cookie fica preso a este host e NÃO é enviado para media.exercitodolula.app, que serve
      // conteúdo público com CORS aberto. Separar os dois domínios é o que impede a sessão de passear.
    });
    return response;
  } catch {
    // Não distinguir "token inválido" de "conta desativada": a resposta é a mesma.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
}

/** Encerra a sessão de servidor. Chamado no logout, junto do `signOut` do Firebase. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
  return response;
}
