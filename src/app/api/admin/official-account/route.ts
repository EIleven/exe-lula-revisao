// src/app/api/admin/official-account/route.ts
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { enableFederation, getFederationStatus } from '@/lib/activitypub/account';
import { OFFICIAL_BROKEN_AVATAR, OFFICIAL_DEFAULT_AVATAR, parseOfficialPost, parseOfficialProfilePatch } from '@/lib/activitypub/officialPost';
import { listDeliveriesForUser, summarizeDeliveries } from '@/lib/activitypub/worker';
import { federation, json, readJsonObject, requireCaller } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { extractHashtagsFromString } from '@/lib/utils/textUtils';
import type { Post } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const OFFICIAL_ACCOUNT_UID = 'official_exercitodolula';
export const OFFICIAL_ACCOUNT_USERNAME = 'ExercitoDoLula';

async function requireAdmin(request: NextRequest, key: string) {
  const caller = await requireCaller(request, key, 60);
  if (caller instanceof Response) return caller;
  const db = adminFirestore();
  const userSnap = await db.collection('users').doc(caller.uid).get();
  if (!userSnap.exists || userSnap.data()?.isAdmin !== true) {
    return json(403, { error: 'apenas-administrador' });
  }
  return { uid: caller.uid, db };
}

async function ensureOfficialAccount() {
  const db = adminFirestore();
  const userRef = db.collection('users').doc(OFFICIAL_ACCOUNT_UID);
  const usernameRef = db.collection('usernames').doc(OFFICIAL_ACCOUNT_USERNAME.toLowerCase());
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    await userRef.set({
      id: OFFICIAL_ACCOUNT_UID,
      name: 'Exército do Lula',
      username: OFFICIAL_ACCOUNT_USERNAME,
      email: '',
      bio: 'Perfil oficial do Exército do Lula — comunicados, campanhas, novidades e atualizações da rede.',
      avatarUrl: OFFICIAL_DEFAULT_AVATAR,
      coverImageUrl: '',
      website: 'https://exercitodolula.app',
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      // 'none' é o valor que a interface entende ("não recebe mensagem direta"). 'nobody' não existe: era lido como "todos".
      dmPreference: 'none',
      isAdmin: false,
      isModerator: false,
      isOfficial: true,
      profileVisibility: 'public',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    // Conserto de quem foi criado antes: avatar de partida que nunca existiu (404) e `dmPreference` que a interface não
    // reconhece. Só os dois valores ERRADOS conhecidos são trocados; uma escolha da administração nunca é desfeita.
    const atual = userSnap.data() ?? {};
    const reparo: Record<string, unknown> = {};
    if (atual.avatarUrl === OFFICIAL_BROKEN_AVATAR) reparo.avatarUrl = OFFICIAL_DEFAULT_AVATAR;
    if (atual.dmPreference === 'nobody') reparo.dmPreference = 'none';
    if (atual.isOfficial !== true) reparo.isOfficial = true;
    if (Object.keys(reparo).length > 0) await userRef.update({ ...reparo, updatedAt: FieldValue.serverTimestamp() });
  }

  const usernameSnap = await usernameRef.get();
  if (!usernameSnap.exists) {
    await usernameRef.set({ userId: OFFICIAL_ACCOUNT_UID });
  }

  const f = federation();
  const status = await getFederationStatus({ store: f.store, ownHost: f.ownHost }, OFFICIAL_ACCOUNT_UID);
  if (!status.enabled) {
    await enableFederation(f.account(), OFFICIAL_ACCOUNT_UID, { emailVerified: true });
  }

  const freshSnap = await userRef.get();
  const freshStatus = await getFederationStatus({ store: f.store, ownHost: f.ownHost }, OFFICIAL_ACCOUNT_UID);
  return {
    profile: { id: OFFICIAL_ACCOUNT_UID, ...(freshSnap.data() || {}) },
    federation: freshStatus,
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request, 'official-account-get');
  if (admin instanceof Response) return admin;
  const data = await ensureOfficialAccount();
  // Saúde das entregas para o Fediverso: quantas saíram, quais servidores falham, quais morreram e por quê (e quantas por
  // assinatura recusada). `null` se a consulta falhar (ela usa um índice composto): melhor dizer que não sabe do que mostrar zero.
  const deliveries = await listDeliveriesForUser({ store: federation().store }, OFFICIAL_ACCOUNT_UID, 100)
    .then((lista) => summarizeDeliveries(lista))
    .catch(() => null);
  return json(200, { ...data, deliveries });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request, 'official-account-patch');
  if (admin instanceof Response) return admin;
  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'corpo-invalido' });

  // Avatar e capa que o Fediverso não consegue buscar eram aceitos e sumiam nas outras instâncias sem erro: agora recusa.
  const parsed = parseOfficialProfilePatch(body, { mediaOrigin: federation().render.mediaOrigin });
  if (!parsed.ok) return json(422, { error: parsed.error, detail: parsed.detail });

  await ensureOfficialAccount();
  await admin.db.collection('users').doc(OFFICIAL_ACCOUNT_UID).update({ ...parsed.patch, updatedAt: FieldValue.serverTimestamp() });
  const updated = await ensureOfficialAccount();
  return json(200, updated);
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request, 'official-account-post');
  if (admin instanceof Response) return admin;
  // 32 KB: um post de 5000 caracteres (até 4 bytes cada) com oito anexos. O teto padrão de 4 KB recusava textos longos.
  const body = await readJsonObject(request, 32 * 1024);
  if (!body) return json(400, { error: 'corpo-invalido' });

  // Tudo que não puder sair para o Fediverso como foi pedido (mídia de fora, mais de 8 anexos, vídeo inválido...) é RECUSADO
  // com um código, em vez de o post sair sem a imagem e ninguém saber.
  const parsed = parseOfficialPost(body, { mediaOrigin: federation().render.mediaOrigin });
  if (!parsed.ok) {
    const campoFaltando = parsed.error === 'conteudo-vazio' || parsed.error === 'titulo-obrigatorio';
    return json(campoFaltando ? 400 : 422, { error: parsed.error, detail: parsed.detail });
  }
  const input = parsed.post;

  const { profile } = await ensureOfficialAccount();
  const category = input.category;
  const media = input.media;
  const hashtags = extractHashtagsFromString(`${input.text} ${input.headline}`);
  const profileData = profile as Record<string, unknown>;

  const authorDetails = {
    userId: OFFICIAL_ACCOUNT_UID,
    name: typeof profileData.name === 'string' ? profileData.name : 'Exército do Lula',
    username: OFFICIAL_ACCOUNT_USERNAME,
    avatarUrl: typeof profileData.avatarUrl === 'string' && profileData.avatarUrl ? profileData.avatarUrl : OFFICIAL_DEFAULT_AVATAR,
    'data-ai-hint': null,
  };

  const postDoc: Record<string, unknown> = {
    userId: OFFICIAL_ACCOUNT_UID,
    authorDetails,
    type: 'original',
    text: input.text || null,
    headline: category === 'news' ? input.headline : null,
    sourceUrl: input.sourceUrl,
    newsCategory: input.newsCategory,
    media: media.length > 0 ? media : null,
    youtubeVideoId: input.youtubeVideoId,
    hasMedia: media.length > 0 || Boolean(input.youtubeVideoId),
    category,
    hashtags: hashtags.length > 0 ? hashtags : null,
    visibility: 'public',
    allowReposts: input.allowReposts,
    replyPermission: input.replyPermission,
    postFormat: 'standard',
    likes: 0,
    reposts: 0,
    quotesCount: 0,
    commentsCount: 0,
    views: 0,
    isEdited: false,
    editCount: 0,
    isDeleted: false,
    location: input.location,
    sensitive: input.sensitive,
    poll: null,
    pollOptionIds: null,
    pollCounts: null,
    pollTotal: 0,
    publishedByAdminId: admin.uid,
    createdAt: FieldValue.serverTimestamp(),
    ...(input.federation !== 'local' ? { federation: input.federation } : {}),
  };

  const ref = await admin.db.collection('posts').add(postDoc);
  const nowIso = new Date().toISOString();
  const createdPost = {
    ...postDoc,
    id: ref.id,
    createdAt: nowIso,
    user: {
      id: OFFICIAL_ACCOUNT_UID,
      name: authorDetails.name,
      username: OFFICIAL_ACCOUNT_USERNAME,
      email: '',
      avatarUrl: authorDetails.avatarUrl,
      bio: typeof profileData.bio === 'string' ? profileData.bio : '',
      followersCount: Number(profileData.followersCount || 0),
      followingCount: Number(profileData.followingCount || 0),
      postsCount: Number(profileData.postsCount || 0),
      dmPreference: 'none',
      isAdmin: false,
      isModerator: false,
      profileVisibility: 'public',
      createdAt: nowIso,
    },
    comments: [],
    isLiked: false,
  } as unknown as Post;

  return json(200, { ok: true, post: createdPost });
}
