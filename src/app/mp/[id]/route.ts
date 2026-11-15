// src/app/mp/[id]/route.ts
// Mídia PRIVADA: anexo de mensagem, arquivo pessoal e qualquer mídia restrita. Substitui o `getDownloadURL()` com
// token permanente, que funcionava sem login, ignorava as regras do Storage e nunca se revogava.
//
// Fica no domínio PRINCIPAL, e não em media.exercitodolula.app: o cookie de sessão é preso a este host, e o domínio
// de mídia serve conteúdo público com CORS aberto. Misturar os dois faria a sessão viajar junto do conteúdo público.
//
// A diferença essencial em relação a um token: a autorização é refeita **a cada requisição**, contra o estado atual
// da conversa e dos bloqueios. Não existe nada emitido que continue valendo depois.
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { adminBucket, adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit, verifySessionUser } from '@/lib/server/requestAuth';
import { isValidMediaId, parseRange, rangeLength } from '@/lib/media/mediaId';
import type { MediaKind } from '@/lib/media/mediaId';
import {
  PRIVATE_MEDIA_HEADERS,
  authorizePrivateMedia,
  conversationIdFor,
  dispositionFor,
} from '@/lib/media/privateAccess';

export const dynamic = 'force-dynamic';

const REQUESTS_PER_WINDOW = 120;
const WINDOW_MS = 60 * 1000;

/** Toda negativa é 404. Um 403 confirmaria que o id existe, e o id é tudo que quem adivinha tem. */
const naoEncontrado = () => new Response(null, { status: 404, headers: PRIVATE_MEDIA_HEADERS });

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'application/pdf': 'pdf',
};

/**
 * Nome de arquivo para o download. Montado por nós a partir do tipo, **nunca** vindo do nome original enviado pela
 * pessoa: nome de arquivo com aspas ou nova linha permite injetar cabeçalho na resposta.
 */
function nomeDeArquivo(contentType: string): string {
  const tipo = contentType.toLowerCase().split(';')[0].trim();
  return `anexo.${EXTENSOES[tipo] ?? 'bin'}`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return servir(request, context, true);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return servir(request, context, false);
}

async function servir(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  comCorpo: boolean,
): Promise<Response> {
  const { id } = await context.params;
  if (!isValidMediaId(id)) return naoEncontrado();

  if (!takeRateLimit(`mp:${requestIp(request)}`, REQUESTS_PER_WINDOW, WINDOW_MS)) {
    return new Response(null, { status: 429, headers: { ...PRIVATE_MEDIA_HEADERS, 'Retry-After': '60' } });
  }

  // Sem sessão válida não se diz nada: 404, igual a id inexistente.
  const requesterUid = await verifySessionUser(request);
  if (!requesterUid) return naoEncontrado();

  const db = adminFirestore();

  let dados: Record<string, unknown>;
  try {
    const snapshot = await db.collection('media').doc(id).get();
    if (!snapshot.exists) return naoEncontrado();
    dados = snapshot.data() as Record<string, unknown>;
  } catch (error) {
    console.error('[media privada] falha ao ler o registro:', error);
    return new Response(null, { status: 500, headers: PRIVATE_MEDIA_HEADERS });
  }

  const ownerUid = typeof dados.ownerUid === 'string' ? dados.ownerUid : '';
  const kind = (typeof dados.kind === 'string' ? dados.kind : 'userFile') as MediaKind;
  const visibility = dados.visibility === 'public' ? 'public' : 'private';
  if (!ownerUid) return naoEncontrado();

  // Participação e bloqueio só são consultados quando podem mudar a decisão: para o próprio dono, não há o que
  // conferir, e cada leitura evitada é latência que não se paga.
  let participantIds: string[] | null = null;
  let ownerBlockedRequester = false;
  let requesterBlockedOwner = false;

  if (requesterUid !== ownerUid && kind === 'dm') {
    const conversationId = conversationIdFor(requesterUid, ownerUid);
    try {
      const [conversa, blocoDoDono, blocoDeQuemPede] = await Promise.all([
        db.collection('conversations').doc(conversationId).get(),
        db.collection('users').doc(ownerUid).collection('blockedUsers').doc(requesterUid).get(),
        db.collection('users').doc(requesterUid).collection('blockedUsers').doc(ownerUid).get(),
      ]);
      const ids = conversa.exists ? (conversa.data()?.participantIds as unknown) : null;
      participantIds = Array.isArray(ids) ? (ids as string[]) : null;
      ownerBlockedRequester = blocoDoDono.exists;
      requesterBlockedOwner = blocoDeQuemPede.exists;
    } catch (error) {
      console.error('[media privada] falha ao conferir participação:', error);
      return new Response(null, { status: 500, headers: PRIVATE_MEDIA_HEADERS });
    }
  }

  const decisao = authorizePrivateMedia(
    { ownerUid, kind, visibility, deleted: Boolean(dados.deletedAt) },
    { requesterUid, participantIds, ownerBlockedRequester, requesterBlockedOwner },
  );
  if (!decisao.allow) return naoEncontrado();

  const processingStatus = typeof dados.processingStatus === 'string' ? dados.processingStatus : '';
  if (['uploading', 'queued', 'dispatching', 'dispatched', 'processing'].includes(processingStatus)) {
    return new Response(null, {
      status: 425,
      headers: {
        ...PRIVATE_MEDIA_HEADERS,
        'Cache-Control': 'no-store',
        'Retry-After': '8',
        'X-Media-Status': processingStatus,
        'X-Media-Progress': String(dados.processingProgress ?? 0),
      },
    });
  }
  if (processingStatus === 'failed') {
    return new Response(null, {
      status: 422,
      headers: { ...PRIVATE_MEDIA_HEADERS, 'Cache-Control': 'no-store', 'X-Media-Status': 'failed' },
    });
  }

  const storagePath = typeof dados.storagePath === 'string' ? dados.storagePath : '';
  if (!storagePath) return naoEncontrado();

  const file = adminBucket().file(storagePath);
  let size = 0;
  try {
    const [metadata] = await file.getMetadata();
    size = Number(metadata.size ?? 0);
  } catch {
    return naoEncontrado();
  }

  const contentType = typeof dados.contentType === 'string' ? dados.contentType : 'application/octet-stream';
  const querDownload = request.nextUrl.searchParams.get('dl') === '1';
  const disposition = dispositionFor(contentType, querDownload);

  const range = parseRange(request.headers.get('range'), size);
  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...PRIVATE_MEDIA_HEADERS, 'Content-Range': `bytes */${size}` },
    });
  }

  const headers: Record<string, string> = {
    ...PRIVATE_MEDIA_HEADERS,
    'Content-Type': contentType,
    'Content-Length': String(rangeLength(range, size)),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${disposition}; filename="${nomeDeArquivo(contentType)}"`,
  };
  if (range.kind === 'partial') {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  }
  const status = range.kind === 'partial' ? 206 : 200;

  if (!comCorpo) return new Response(null, { status, headers });

  const stream = range.kind === 'partial'
    ? file.createReadStream({ start: range.start, end: range.end })
    : file.createReadStream();

  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}
