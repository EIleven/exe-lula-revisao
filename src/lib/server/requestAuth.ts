// src/lib/server/requestAuth.ts
// Só para rotas de API (servidor): identifica quem chama pelo ID token do Firebase (cabeçalho Authorization: Bearer)
// e limita o ritmo de uso por pessoa ou por IP. A verificação do token usa as chaves públicas do Google (não precisa de
// credencial); com os emuladores ligados, aceita os tokens do emulador de Auth.
import { adminAuth } from './firebaseAdmin';

/** uid de quem chamou, ou null se não houver token válido (ausente, vencido, de outro projeto ou revogado). */
export async function verifyRequestUser(request: Request): Promise<string | null> {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  try {
    return (await adminAuth().verifyIdToken(match[1])).uid;
  } catch {
    return null;
  }
}

/** UsuÃ¡rio habilitado para publicar/interagir: perfil da rede e e-mail confirmado. */
export async function verifyRequestMember(request: Request): Promise<string | null> {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  try {
    const token = await adminAuth().verifyIdToken(match[1]);
    return token.email_verified === true && token.member === true ? token.uid : null;
  } catch {
    return null;
  }
}

/**
 * IP de quem chamou, atrás do balanceador do Google (App Hosting). O balanceador ACRESCENTA ao x-forwarded-for o IP
 * do cliente e o dele: "<o que o cliente mandou>, <cliente>, <balanceador>". O primeiro item pode ser forjado pelo
 * próprio cliente (e burlaria o limite de ritmo); o confiável é o penúltimo. Com um item só, é ele.
 */
export function requestIp(request: Request): string {
  const hops = (request.headers.get('x-forwarded-for') ?? '').split(',').map((hop) => hop.trim()).filter(Boolean);
  if (hops.length === 0) return 'desconhecido';
  return hops.length >= 2 ? hops[hops.length - 2] : hops[0];
}

// Janela deslizante em memória, por instância do servidor: aproximada (cada instância conta à parte), mas basta para
// impedir que uma pessoa use o servidor como robô de busca.
const hits = new Map<string, number[]>();

/** true se ainda cabe uma chamada de `key` na janela; false se estourou o limite. */
export function takeRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    for (const [entry, times] of hits) {
      if (!times.some((time) => now - time < windowMs)) hits.delete(entry);
    }
  }
  return true;
}

/**
 * uid de quem chamou, pelo COOKIE de sessao (`__session`), nao pelo cabecalho Authorization.
 *
 * Existe para a midia privada: `<img>`, `<video>` e link de download nao mandam cabecalho, mas mandam cookie. Ver
 * src/app/api/auth/session/route.ts, inclusive sobre o nome do cookie, que nao e escolha nossa.
 *
 * `checkRevoked: true` custa uma verificacao no servico de Auth a cada requisicao, e vale o preco: e o que faz o
 * acesso parar NA HORA para conta desativada, excluida ou com sessao revogada. Com `false`, o cookie continuaria
 * valendo ate expirar — e "parar imediatamente" e justamente o requisito que separa esta camada do token permanente
 * que ela substitui.
 */
export async function verifySessionUser(request: Request): Promise<string | null> {
  const bruto = request.headers.get('cookie') ?? '';
  const par = bruto.split(';').map((p) => p.trim()).find((p) => p.startsWith('__session='));
  if (!par) return null;
  const valor = decodeURIComponent(par.slice('__session='.length));
  if (!valor) return null;
  try {
    const { adminAuth } = await import('./firebaseAdmin');
    return (await adminAuth().verifySessionCookie(valor, true)).uid;
  } catch {
    return null;
  }
}
