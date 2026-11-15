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
  contentTypeMatchesMediaPath,
  isValidMediaStoragePath,
  normalizedMediaContentType,
} from '@/lib/media/uploadPolicy';
import {
  isVideoDurationAllowed,
  videoOutputPath,
  videoStagingPath,
} from '@/lib/media/videoPolicy';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { verifyRequestMember } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

interface InitBody {
  storagePath?: unknown;
  contentType?: unknown;
  size?: unknown;
  durationSeconds?: unknown;
}

export async function POST(request: NextRequest) {
  const uid = await verifyRequestMember(request);
  if (!uid) return json({ error: 'unauthorized' }, 401);

  let body: InitBody;
  try {
    body = await request.json() as InitBody;
  } catch {
    return json({ error: 'invalid-request' }, 400);
  }

  const requestedPath = typeof body.storagePath === 'string' ? body.storagePath.trim() : '';
  const contentType = normalizedMediaContentType(typeof body.contentType === 'string' ? body.contentType : '');
  const size = Number(body.size);
  const durationSeconds = body.durationSeconds == null ? null : Number(body.durationSeconds);
  if (!contentType.startsWith('video/')) return json({ error: 'not-a-video' }, 415);
  if (!Number.isSafeInteger(size) || size <= 0) return json({ error: 'invalid-file-size' }, 400);
  if (!isVideoDurationAllowed(durationSeconds)) {
    return json({ error: 'video-too-long', maxDurationSeconds: 10_200 }, 422);
  }
  if (
    !isValidMediaStoragePath(requestedPath, uid) ||
    !contentTypeMatchesMediaPath(requestedPath, contentType)
  ) {
    return json({ error: 'invalid-storage-path' }, 400);
  }

  const mediaId = generateMediaId();
  const kind = kindFromPath(requestedPath);
  const visibility = visibilityForKind(kind);
  const outputPath = videoOutputPath(requestedPath, mediaId);
  const sourcePath = videoStagingPath(uid, mediaId);
  const db = adminFirestore();
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  batch.create(db.collection('media').doc(mediaId), {
    storagePath: outputPath,
    contentType: 'video/mp4',
    size: 0,
    ownerUid: uid,
    visibility,
    kind,
    processingStatus: 'uploading',
    processingProgress: 0,
    createdAt: now,
    updatedAt: now,
  });
  batch.create(db.collection('videoUploads').doc(mediaId), {
    mediaId,
    ownerUid: uid,
    kind,
    visibility,
    sourcePath,
    outputPath,
    sourceContentType: contentType,
    sourceSize: size,
    clientDurationSeconds: durationSeconds,
    status: 'uploading',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });

  try {
    await batch.commit();
  } catch (error) {
    console.error('[video init] falha ao criar registro:', error);
    return json({ error: 'init-failed' }, 500);
  }

  const downloadURL = canBePublic(kind)
    ? publicMediaUrl(mediaId, siteConfig.mediaOrigin)
    : privateMediaPath(mediaId);

  return json({
    mediaId,
    sourcePath,
    filePath: outputPath,
    downloadURL,
    status: 'uploading',
  }, 201);
}
