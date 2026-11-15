// Upload sem token permanente: o navegador autentica a chamada e o servidor grava pelo Admin SDK do GCS.
// As leituras acontecem exclusivamente pelas rotas /m (publica) e /mp (privada).
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse, type NextRequest } from 'next/server';
import { siteConfig } from '@/config/site';
import {
  canBePublic,
  generateMediaId,
  kindFromPath,
  privateMediaPath,
  publicMediaUrl,
  visibilityForKind,
} from '@/lib/media/mediaId';
import {
  MAX_MEDIA_FILE_SIZE,
  contentTypeMatchesMediaPath,
  isAllowedMediaContentType,
  isValidMediaStoragePath,
  normalizedMediaContentType,
} from '@/lib/media/uploadPolicy';
import { adminBucket, adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit, verifyRequestMember } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REQUEST_SIZE = MAX_MEDIA_FILE_SIZE + 256 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_USER = 40;
const MAX_PER_IP = 80;

const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  const uid = await verifyRequestMember(request);
  if (!uid) return json({ error: 'unauthorized' }, 401);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
    return json({ error: 'request-too-large' }, 413);
  }

  const ip = requestIp(request);
  if (
    !takeRateLimit(`media-upload:uid:${uid}`, MAX_PER_USER, WINDOW_MS) ||
    !takeRateLimit(`media-upload:ip:${ip}`, MAX_PER_IP, WINDOW_MS)
  ) {
    return json({ error: 'too-many-requests' }, 429);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'invalid-request' }, 400);
  }

  const entry = form.get('file');
  const pathEntry = form.get('storagePath');
  if (!(entry instanceof File) || typeof pathEntry !== 'string') {
    return json({ error: 'invalid-request' }, 400);
  }

  const storagePath = pathEntry.trim();
  const contentType = normalizedMediaContentType(entry.type);
  if (entry.size <= 0 || entry.size >= MAX_MEDIA_FILE_SIZE) return json({ error: 'invalid-file-size' }, 413);
  if (!isAllowedMediaContentType(contentType)) return json({ error: 'invalid-content-type' }, 415);
  if (!isValidMediaStoragePath(storagePath, uid) || !contentTypeMatchesMediaPath(storagePath, contentType)) {
    return json({ error: 'invalid-storage-path' }, 400);
  }

  const kind = kindFromPath(storagePath);
  const mediaId = generateMediaId();
  const object = adminBucket().file(storagePath);
  let uploaded = false;

  try {
    const bytes = Buffer.from(await entry.arrayBuffer());
    if (bytes.byteLength !== entry.size || bytes.byteLength >= MAX_MEDIA_FILE_SIZE) {
      return json({ error: 'invalid-file-size' }, 413);
    }

    // A API administrativa do GCS nao cria token do Firebase. A precondicao impede sobrescrever objeto existente.
    await object.save(bytes, {
      resumable: false,
      validation: 'crc32c',
      metadata: { contentType },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    uploaded = true;

    await adminFirestore().collection('media').doc(mediaId).create({
      storagePath,
      contentType,
      size: entry.size,
      ownerUid: uid,
      visibility: visibilityForKind(kind),
      kind,
      createdAt: FieldValue.serverTimestamp(),
    });

    const downloadURL = canBePublic(kind)
      ? publicMediaUrl(mediaId, siteConfig.mediaOrigin)
      : privateMediaPath(mediaId);
    return json({ downloadURL, filePath: storagePath, mediaId }, 201);
  } catch (error) {
    console.error('[media upload] falha ao gravar objeto ou registro:', error);
    if (uploaded) {
      try {
        await object.delete();
      } catch (cleanupError) {
        console.error('[media upload] falha ao remover objeto sem registro:', cleanupError);
      }
    }
    return json({ error: 'upload-failed' }, 500);
  }
}
