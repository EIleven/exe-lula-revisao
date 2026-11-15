// src/app/m/[id]/route.ts
// Serve mídia pública em media.exercitodolula.app, sem expor o host do Storage, o caminho interno, o UID nem token
// de download. Ver docs/arquitetura-midia.md.
//
// POR QUE ISTO NÃO É UM OPEN PROXY: a URL traz um identificador opaco, nunca um caminho. O caminho sai de
// `media/{id}` no nosso banco. Não existe entrada pela qual o cliente consiga pedir um objeto arbitrário do bucket —
// e `isValidMediaId` recusa antes de tocar no banco qualquer coisa que não seja exatamente o formato do id.
//
// Esta rota fica FORA de `[locale]`: mídia não tem idioma, e o middleware de i18n não casa com `/m/...`.
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { LRUCache } from 'lru-cache';
import { adminBucket, adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';
import {
  MEDIA_CACHE_CONTROL,
  isValidMediaId,
  parseRange,
  rangeLength,
} from '@/lib/media/mediaId';

export const dynamic = 'force-dynamic';

// Teto generoso: um feed carrega muitas imagens de uma vez, e a CDN absorve a repetição. Isto não existe contra
// enumeração (o id tem ~132 bits, adivinhar é inviável), mas contra alguém repuxar um vídeo grande para queimar
// egresso. É por instância e em memória, então é um freio, não uma garantia.
const REQUESTS_PER_WINDOW = 300;
const WINDOW_MS = 60 * 1000;

interface CachedMediaMeta {
  storagePath: string;
  contentType: string;
  size: number;
  etag: string;
}

const readyMediaCache = new LRUCache<string, CachedMediaMeta>({
  max: 4000,
  ttl: 15 * 60 * 1000,
});
const tombstoneCache = new LRUCache<string, true>({
  max: 500,
  ttl: 5 * 60 * 1000,
});
const inFlightMeta = new Map<string, Promise<CachedMediaMeta | { earlyStatus: number; headers?: Record<string, string> }>>();

interface MediaDoc {
  storagePath?: string;
  contentType?: string;
  visibility?: string;
  deletedAt?: unknown;
  processingStatus?: string;
  processingProgress?: number;
}

// O player do site (outro domínio) consulta esta rota por `fetch` para saber se o vídeo está pronto. Sem
// `Access-Control-Allow-Origin` o navegador esconde o status (410, 422, 425...) e o player ficaria esperando para sempre;
// sem `Expose-Headers` ele não leria o progresso. Todas as respostas levam os mesmos cabeçalhos, inclusive o 404
// uniforme, então isto não revela nada sobre o id.
const CORS_PUBLICO: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Media-Status, X-Media-Progress, Retry-After, Content-Length, Content-Range, Accept-Ranges',
};

const vazio = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers: { ...CORS_PUBLICO, ...headers } });

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

  // Formato errado nem chega ao banco. É aqui que morrem `../`, caminho com barra e id de tamanho estranho.
  if (!isValidMediaId(id)) return vazio(404);

  if (!takeRateLimit(`media:${requestIp(request)}`, REQUESTS_PER_WINDOW, WINDOW_MS)) {
    return vazio(429, { 'Retry-After': '60' });
  }

  if (tombstoneCache.get(id)) {
    return vazio(410, { 'Cache-Control': 'public, max-age=300' });
  }

  let resolved = readyMediaCache.get(id);
  if (!resolved) {
    let pending = inFlightMeta.get(id);
    if (!pending) {
      pending = (async (): Promise<CachedMediaMeta | { earlyStatus: number; headers?: Record<string, string> }> => {
        let doc: MediaDoc | undefined;
        try {
          const snapshot = await adminFirestore().collection('media').doc(id).get();
          if (!snapshot.exists) return { earlyStatus: 404 };
          doc = snapshot.data() as MediaDoc;
        } catch (error) {
          console.error('[media] falha ao ler o registro:', error);
          return { earlyStatus: 500 };
        }

        // Privado responde 404, NÃO 403. Um 403 confirmaria que o id existe, e o id é a única coisa que o atacante tem.
        // Isto vem ANTES do tombstone de propósito: um privado já REMOVIDO também responde 404. Um 410 contaria que o id
        // existiu e foi apagado, e o 404 uniforme é o que impede o id de confirmar qualquer coisa a quem o adivinha.
        if (doc.visibility !== 'public') return { earlyStatus: 404 };

        // Tombstone: existiu e foi removido. 410 e não 404, porque a diferença é informação útil e honesta para quem
        // guardou o link — e porque consumidor de Open Graph trata 410 como definitivo e para de tentar.
        if (doc.deletedAt) {
          tombstoneCache.set(id, true);
          return { earlyStatus: 410, headers: { 'Cache-Control': 'public, max-age=300' } };
        }

        if (['uploading', 'queued', 'dispatching', 'dispatched', 'processing'].includes(doc.processingStatus ?? '')) {
          return {
            earlyStatus: 425,
            headers: {
              'Cache-Control': 'no-store',
              'Retry-After': '8',
              'X-Media-Status': doc.processingStatus ?? 'processing',
              'X-Media-Progress': String(doc.processingProgress ?? 0),
              'Access-Control-Allow-Origin': '*',
            },
          };
        }
        if (doc.processingStatus === 'failed') {
          return { earlyStatus: 422, headers: { 'Cache-Control': 'no-store', 'X-Media-Status': 'failed' } };
        }

        const storagePath = typeof doc.storagePath === 'string' ? doc.storagePath : '';
        if (!storagePath) return { earlyStatus: 404 };

        try {
          const [metadata] = await adminBucket().file(storagePath).getMetadata();
          const meta: CachedMediaMeta = {
            storagePath,
            contentType: doc.contentType || 'application/octet-stream',
            size: Number(metadata.size ?? 0),
            etag: `"${metadata.generation ?? metadata.etag ?? '0'}"`,
          };
          readyMediaCache.set(id, meta);
          return meta;
        } catch {
          // Registro existe mas o objeto não: tratado como ausente, sem revelar a diferença.
          return { earlyStatus: 404 };
        }
      })().finally(() => {
        inFlightMeta.delete(id);
      });
      inFlightMeta.set(id, pending);
    }

    const result = await pending;
    if ('earlyStatus' in result) {
      return vazio(result.earlyStatus, result.headers);
    }
    resolved = result;
  }

  const { storagePath, contentType, size, etag } = resolved;
  const file = adminBucket().file(storagePath);
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': MEDIA_CACHE_CONTROL,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Content-Disposition': 'inline',
    // Mídia pública precisa ser incorporável fora do site; é o que faz o card do WhatsApp e o vídeo no X abrirem.
    ...CORS_PUBLICO,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Range',
  };

  if (request.headers.get('if-none-match') === etag) {
    return vazio(304, { ETag: etag, 'Cache-Control': MEDIA_CACHE_CONTROL });
  }

  const range = parseRange(request.headers.get('range'), size);
  if (range.kind === 'unsatisfiable') {
    return vazio(416, { ...baseHeaders, 'Content-Range': `bytes */${size}` });
  }

  const length = rangeLength(range, size);
  const headers: Record<string, string> = { ...baseHeaders, 'Content-Length': String(length) };
  if (range.kind === 'partial') {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  }
  const status = range.kind === 'partial' ? 206 : 200;

  if (!comCorpo) return vazio(status, headers);

  const stream = range.kind === 'partial'
    ? file.createReadStream({ start: range.start, end: range.end })
    : file.createReadStream();

  // O stream do Node precisa virar stream da Web para o Response do Next.
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}
