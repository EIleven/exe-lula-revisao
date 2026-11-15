// src/lib/media/privateAccess.ts
// Autorização de mídia PRIVADA: anexo de mensagem, arquivo pessoal e qualquer mídia com visibilidade restrita.
// Lógica pura, sem Firebase e sem Next, para o `npm run e2e:midia-privada` exercitar todos os casos sem app.
//
// O QUE ISTO SUBSTITUI: até agora anexo de mensagem e arquivo pessoal recebiam `getDownloadURL()`, que embute um
// token permanente. Esse token é uma credencial: funciona sem login, ignora as regras do Storage, não expira e não
// se revoga ao bloquear alguém ou excluir a conta. Quem recebeu o link uma vez lia para sempre.
//
// A TROCA: a URL privada não carrega credencial nenhuma. Ela é só um identificador, e a autorização é refeita **a
// cada requisição**, contra o estado atual. É isso que faz o acesso parar na hora para quem foi removido, bloqueado
// ou deixou de participar — o contrário de um token, que concede para sempre no momento em que é emitido.

import type { MediaKind } from './mediaId';

/**
 * Id da conversa entre duas pessoas. As conversas desta rede são estritamente de DOIS participantes e o id é
 * determinístico (`<menor uid>_<maior uid>`, conforme `isValidNewConversation` em firestore.rules), então dá para
 * derivar a conversa a partir de quem enviou o arquivo e de quem está pedindo — sem guardar `conversationId` no
 * registro da mídia, que seria mais um campo para manter em sincronia.
 */
export function conversationIdFor(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

export interface PrivateMediaRecord {
  ownerUid: string;
  kind: MediaKind;
  visibility: 'public' | 'private';
  deleted: boolean;
}

export interface PrivateAccessContext {
  /** Quem está pedindo. `null` = sem sessão válida. */
  requesterUid: string | null;
  /** `participantIds` da conversa derivada, ou `null` se a conversa não existe. */
  participantIds: string[] | null;
  /** O dono bloqueou quem pede. */
  ownerBlockedRequester: boolean;
  /** Quem pede bloqueou o dono. */
  requesterBlockedOwner: boolean;
}

export type AccessDecision =
  | { allow: true; reason: 'dono' | 'participante' }
  | { allow: false; reason: AccessDenialReason };

export type AccessDenialReason =
  | 'sem-sessao'
  | 'removido'
  | 'nao-e-privada'
  | 'nao-participa'
  | 'bloqueado'
  | 'tipo-sem-regra';

/**
 * Decide se serve. **Toda negativa vira 404 na rota**, nunca 403: um 403 confirmaria que o id existe, e o id é a
 * única coisa que alguém tentando adivinhar tem em mãos. O motivo detalhado serve para log e teste, não para a
 * resposta.
 */
export function authorizePrivateMedia(
  media: PrivateMediaRecord,
  ctx: PrivateAccessContext,
): AccessDecision {
  if (!ctx.requesterUid) return { allow: false, reason: 'sem-sessao' };

  // Conteúdo removido não volta nem para o dono. O tombstone aqui não vira 410 como na rota pública: dizer "existiu"
  // já é informação sobre uma conversa privada.
  if (media.deleted) return { allow: false, reason: 'removido' };

  // Mídia pública não passa por aqui; se passar, é erro de roteamento e não se serve por este caminho.
  if (media.visibility !== 'private') return { allow: false, reason: 'nao-e-privada' };

  // O dono sempre alcança o que é dele, inclusive o próprio anexo enviado.
  if (ctx.requesterUid === media.ownerUid) return { allow: true, reason: 'dono' };

  if (media.kind === 'dm') {
    // Espelha `canReadMessages()` de firestore.rules: quem está em participantIds lê a mensagem, então lê o anexo.
    const participa =
      Array.isArray(ctx.participantIds) &&
      ctx.participantIds.includes(ctx.requesterUid) &&
      ctx.participantIds.includes(media.ownerUid);
    if (!participa) return { allow: false, reason: 'nao-participa' };

    // Bloqueio corta nos DOIS sentidos. Isto é MAIS estrito que a regra de mensagens, que hoje não olha bloqueio
    // para leitura — ver a nota em docs/midia-privada.md: o texto da mensagem antiga continua visível e o anexo não.
    if (ctx.ownerBlockedRequester || ctx.requesterBlockedOwner) {
      return { allow: false, reason: 'bloqueado' };
    }
    return { allow: true, reason: 'participante' };
  }

  // Arquivo pessoal, avatar e capa privados: só o dono, e o dono já foi tratado acima.
  if (media.kind === 'userFile' || media.kind === 'avatar' || media.kind === 'cover' || media.kind === 'postMedia') {
    return { allow: false, reason: 'nao-participa' };
  }

  // Tipo novo sem regra escrita: negar. O padrão seguro é não servir.
  return { allow: false, reason: 'tipo-sem-regra' };
}

/**
 * Tipos que podem ser renderizados direto no navegador. Imagem, vídeo, áudio e PDF entram; **SVG e qualquer coisa
 * com HTML ficam de fora de propósito**.
 *
 * Por quê: esta rota serve do NOSSO domínio, com a sessão da pessoa nos cookies. Um SVG é um documento que executa
 * script. Servi-lo `inline` daqui seria dar a um arquivo enviado por outra pessoa a chance de rodar no nosso
 * contexto de origem — XSS armazenado, pelo caminho mais curto possível. Forçar download tira o perigo sem impedir
 * que a pessoa abra o arquivo se quiser.
 */
const INLINE_PREFIXES = ['image/', 'video/', 'audio/'];
const INLINE_EXACT = ['application/pdf'];
const NUNCA_INLINE = ['image/svg+xml', 'image/svg', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml'];

export function canRenderInline(contentType: string | null | undefined): boolean {
  const tipo = (contentType ?? '').toLowerCase().split(';')[0].trim();
  if (!tipo) return false;
  if (NUNCA_INLINE.includes(tipo)) return false;
  if (INLINE_EXACT.includes(tipo)) return true;
  return INLINE_PREFIXES.some((prefixo) => tipo.startsWith(prefixo));
}

/** `inline` para o que é seguro exibir, `attachment` para o resto e sempre que a pessoa pedir download. */
export function dispositionFor(contentType: string | null | undefined, wantsDownload: boolean): 'inline' | 'attachment' {
  return !wantsDownload && canRenderInline(contentType) ? 'inline' : 'attachment';
}

/**
 * Cabeçalhos que impedem a mídia privada de ser guardada por intermediário, indexada ou incorporada fora do site.
 *
 * `no-store` e não `private, max-age=...`: com cache, revogar o acesso deixaria de ter efeito imediato, que é
 * justamente a propriedade que esta camada existe para garantir. O custo é a origem ser tocada sempre — aceitável,
 * porque conversa privada não tem o volume de um feed público.
 */
export const PRIVATE_MEDIA_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow, noimageindex, noarchive',
  // Sem `Access-Control-Allow-Origin`: outro site não consegue ler por fetch.
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  // A resposta muda conforme a sessão: sem isto um intermediário poderia servir a de uma pessoa para outra.
  Vary: 'Cookie, Range',
});
