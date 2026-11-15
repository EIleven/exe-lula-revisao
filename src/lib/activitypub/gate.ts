// src/lib/activitypub/gate.ts
// O portão da federação: decide se um conteúdo PODE sair, e como se trata uma instância remota. Módulo puro, sem
// imports, para a suíte exercitar cada recusa.
//
// As TRÊS autorizações precisam existir ao mesmo tempo para um conteúdo sair da rede:
//
//   1. PLATAFORMA — a rede inteira ligou a federação (e não acionou o botão de emergência);
//   2. CONTA      — a pessoa escolheu federar, e não pausou;
//   3. PUBLICAÇÃO — este post pediu para sair, com um alcance que a visibilidade dele comporta.
//
// E mais duas regras que valem por si:
//
// - **Religar não federa o passado** (ADR-AP-6): o post só sai se nasceu DEPOIS do momento em que a conta ficou
//   elegível (`eligibleSince`, regravado a cada ativação e a cada retomada).
// - **Apagar é sempre permitido** para o que já saiu. Conta pausada ou desligada não impede o `Delete` de algo que
//   já foi entregue: impedir seria prender a pessoa a uma cópia que ela quer retirar.
//
// Este portão roda DUAS vezes: um pré-filtro barato na Function que enfileira e, de novo e valendo, no worker no
// momento do envio (ameaça T6 — elegibilidade conferida na hora de enviar, não só na de enfileirar).

export const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

export type FederationScope = 'public' | 'unlisted' | 'followers';
export type PostFederation = 'local' | FederationScope;
export const FEDERATION_SCOPES: readonly FederationScope[] = ['public', 'unlisted', 'followers'];

export type PlatformFlags = {
  enabled: boolean;
  /** Botão de emergência: com ele ligado NADA sai nem entra, qualquer que seja o resto. */
  killSwitch?: boolean;
  mode: 'open' | 'allowlist';
};

export type AccountFederation = {
  enabled: boolean;
  paused: boolean;
  /** Milissegundos. Posts anteriores a isto nunca federam. */
  eligibleSince: number;
  handle: string | null;
};

export type PostForGate = {
  userId: string;
  /** Visibilidade LOCAL: vem do perfil do autor, não de uma escolha por post. */
  visibility: 'public' | 'followers' | 'private';
  federation: string | null | undefined;
  type?: string | null;
  category?: string | null;
  createdAtMs: number;
  isDeleted?: boolean;
  hasPoll?: boolean;
  /** Já foi entregue alguma vez? Definido pelo worker quando o `Create` sai. */
  apObjectId?: string | null;
};

export type GateOp = 'create' | 'update' | 'delete';

export type GateReason =
  | 'plataforma-desligada'
  | 'conta-nao-optou'
  | 'conta-pausada'
  | 'post-local'
  | 'post-privado'
  | 'visibilidade-incompativel'
  | 'anterior-a-ativacao'
  | 'post-apagado'
  | 'tipo-nao-suportado'
  | 'categoria-nao-suportada'
  | 'enquete-nao-suportada'
  | 'nao-federado-antes';

export type GateDecision =
  | { allowed: true; scope: FederationScope }
  | { allowed: false; reason: GateReason };

const negar = (reason: GateReason): GateDecision => ({ allowed: false, reason });

export function normalizeFederation(valor: unknown): PostFederation {
  return typeof valor === 'string' && (FEDERATION_SCOPES as readonly string[]).includes(valor)
    ? (valor as FederationScope)
    : 'local';
}

/**
 * Um alcance comporta-se dentro da visibilidade local? O alcance de fora NUNCA é maior que o de dentro:
 * `public`/`unlisted` exigem post público; `followers` aceita público ou só-seguidores; `private` nunca sai.
 */
export function scopeFitsVisibility(scope: FederationScope, visibility: PostForGate['visibility']): boolean {
  if (visibility === 'private') return false;
  if (scope === 'followers') return visibility === 'public' || visibility === 'followers';
  return visibility === 'public';
}

export function evaluateGate(entrada: {
  op: GateOp;
  platform: PlatformFlags;
  account: AccountFederation;
  post: PostForGate;
}): GateDecision {
  const { op, platform, account, post } = entrada;

  // 1. PLATAFORMA — vale para tudo, inclusive apagar. Botão de emergência é botão de emergência.
  if (!platform.enabled || platform.killSwitch) return negar('plataforma-desligada');

  const alcance = normalizeFederation(post.federation);

  // Retirar o que já saiu: não depende de a conta continuar ativa nem de o post continuar elegível.
  if (op === 'delete') {
    if (!post.apObjectId) return negar('nao-federado-antes');
    return { allowed: true, scope: alcance === 'local' ? 'public' : alcance };
  }

  // 3. PUBLICAÇÃO
  if (alcance === 'local') return negar('post-local');
  if (post.visibility === 'private') return negar('post-privado');
  if (!scopeFitsVisibility(alcance, post.visibility)) return negar('visibilidade-incompativel');

  // 2. CONTA
  if (!account.enabled || !account.handle) return negar('conta-nao-optou');
  if (account.paused) return negar('conta-pausada');

  // O que o motor sabe representar. O resto fica de fora declaradamente, em vez de sair quebrado.
  if (post.isDeleted) return negar('post-apagado');
  if (post.type && post.type !== 'original' && post.type !== 'quote' && post.type !== 'repost') {
    return negar('tipo-nao-suportado');
  }
  if (post.category && post.category !== 'echo' && post.category !== 'news') return negar('categoria-nao-suportada');
  if (post.hasPoll) return negar('enquete-nao-suportada');

  if (op === 'create' && post.createdAtMs < account.eligibleSince) return negar('anterior-a-ativacao');
  // Atualizar algo que nunca saiu não faz sentido: o `Create` pendente já lê o conteúdo mais recente.
  if (op === 'update' && !post.apObjectId) return negar('nao-federado-antes');

  return { allowed: true, scope: alcance };
}

// ───────────────────────── Endereçamento ─────────────────────────

export type Addressing = { to: string[]; cc: string[] };

/**
 * `to`/`cc` por alcance, como Mastodon interpreta:
 * - `public`   → público (to), seguidores em cc;
 * - `unlisted` → seguidores (to), público em cc — existe, mas não aparece em linhas do tempo públicas;
 * - `followers`→ só a coleção de seguidores.
 *
 * LIMITE REAL DO PROTOCOLO: `followers` é uma convenção de endereçamento, não um cadeado. O servidor de quem nos
 * segue recebe o conteúdo e decide como protegê-lo. É o que a interface diz à pessoa.
 */
export function addressingFor(scope: FederationScope, followersCollection: string): Addressing {
  if (scope === 'public') return { to: [AS_PUBLIC], cc: [followersCollection] };
  if (scope === 'unlisted') return { to: [followersCollection], cc: [AS_PUBLIC] };
  return { to: [followersCollection], cc: [] };
}

// ───────────────────────── Instâncias remotas ─────────────────────────

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** Domínio normalizado (minúsculas, sem ponto final), ou `null`. */
export function normalizeDomain(bruto: string | null | undefined): string | null {
  if (typeof bruto !== 'string') return null;
  const dominio = bruto.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return HOSTNAME.test(dominio) ? dominio : null;
}

export type InstanceAction = 'allow' | 'silence' | 'suspend';
export type InstancePolicy = {
  mode: 'open' | 'allowlist';
  /** Chave = domínio. A regra de um domínio vale para os subdomínios dele, salvo regra mais específica. */
  rules: Readonly<Record<string, { action: InstanceAction }>>;
};

export type InstanceDecision = {
  /** `accept` entra; `limit` entra mas só o que a pessoa pediu; `reject` não entra. */
  decision: 'accept' | 'limit' | 'reject';
  reason:
    | 'permitida'
    | 'silenciada'
    | 'suspensa'
    | 'fora-da-lista-permitida'
    | 'dominio-invalido'
    | 'dominio-local'
    | 'aberta';
};

/** Do mais específico ao mais geral: `a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`. */
function ancestrais(dominio: string): string[] {
  const rotulos = dominio.split('.');
  const lista: string[] = [];
  for (let i = 0; i <= rotulos.length - 2; i++) lista.push(rotulos.slice(i).join('.'));
  return lista;
}

/**
 * Política da casa para um domínio. A regra mais específica ganha: `suspend` em `ruim.example.com` vale mesmo que
 * `example.com` esteja permitido. No modo `allowlist`, domínio sem regra `allow` (nele ou num ancestral) é recusado.
 *
 * `silence` não recusa: o conteúdo entra para quem JÁ segue aquela conta, mas a instância não alimenta nada que a
 * pessoa não pediu (descoberta, respostas e menções vindas de desconhecidos).
 */
export function decideInstance(dominioBruto: string, policy: InstancePolicy, proprioDominio: string): InstanceDecision {
  const dominio = normalizeDomain(dominioBruto);
  if (!dominio) return { decision: 'reject', reason: 'dominio-invalido' };
  if (dominio === proprioDominio.toLowerCase()) return { decision: 'reject', reason: 'dominio-local' };

  let regra: InstanceAction | null = null;
  for (const candidato of ancestrais(dominio)) {
    const r = policy.rules[candidato];
    if (r) {
      regra = r.action;
      break;
    }
  }

  if (regra === 'suspend') return { decision: 'reject', reason: 'suspensa' };
  if (regra === 'silence') return { decision: 'limit', reason: 'silenciada' };
  if (regra === 'allow') return { decision: 'accept', reason: 'permitida' };
  if (policy.mode === 'allowlist') return { decision: 'reject', reason: 'fora-da-lista-permitida' };
  return { decision: 'accept', reason: 'aberta' };
}

// ───────────────────────── Bloqueios por pessoa ─────────────────────────

export type UserBlock = { scope: 'actor' | 'domain'; value: string };

/** A pessoa bloqueou este ator, ou o domínio dele (incluindo subdomínios)? */
export function isBlockedByUser(blocks: readonly UserBlock[], actorId: string, dominio: string): boolean {
  const d = normalizeDomain(dominio);
  const anc = d ? ancestrais(d) : [];
  return blocks.some((b) => (b.scope === 'actor' ? b.value === actorId : anc.includes(b.value)));
}
