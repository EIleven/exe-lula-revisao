import { NextResponse } from 'next/server';
import { verifyRequestMember, takeRateLimit } from '@/lib/server/requestAuth';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { isSocialProvider, type SocialProvider } from '@/lib/social/types';
import { publishToProvider } from '@/lib/server/socialPublish';

export const maxDuration = 30;

export async function POST(request: Request) {
  const uid = await verifyRequestMember(request);
  if (!uid) return NextResponse.json({ message: 'Confirme seu e-mail para publicar em outras redes.' }, { status: 403 });
  if (!takeRateLimit(`social-publish:${uid}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ message: 'Muitos envios em pouco tempo. Aguarde alguns minutos.' }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const postId = typeof body.postId === 'string' ? body.postId.trim() : '';
  const providers = Array.isArray(body.providers)
    ? [...new Set(body.providers.filter(isSocialProvider))] as SocialProvider[]
    : [];
  if (!postId || postId.includes('/') || postId.length > 256 || providers.length === 0) {
    return NextResponse.json({ message: 'Publicação ou redes inválidas.' }, { status: 400 });
  }
  const snapshot = await adminFirestore().collection('posts').doc(postId).get();
  if (!snapshot.exists) return NextResponse.json({ message: 'Post não encontrado.' }, { status: 404 });
  const post = { id: snapshot.id, ...snapshot.data() } as {
    id: string; userId: string; visibility?: string; isDeleted?: boolean;
    text?: string | null; headline?: string | null; authorDetails?: { name?: string; username?: string };
  };
  if (post.userId !== uid) return NextResponse.json({ message: 'Você não pode publicar esse post.' }, { status: 403 });
  // The external networks are public. This is the hard boundary that prevents a private/followers-only post leaking.
  if (post.visibility !== 'public' || post.isDeleted) {
    return NextResponse.json({ message: 'Apenas posts públicos podem ser enviados a outras redes.' }, { status: 409 });
  }
  const locale = body.locale === 'en' ? 'en' : 'pt-BR';
  const results = await Promise.all(providers.map((provider) => publishToProvider(uid, post, provider, locale)));
  return NextResponse.json({ results });
}
