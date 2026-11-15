import { NextResponse } from 'next/server';
import { verifyRequestUser, takeRateLimit } from '@/lib/server/requestAuth';
import { cleanupSocialData, getConnection } from '@/lib/server/socialStore';
import { getBlueskyOAuthClient } from '@/lib/server/blueskyOAuth';

/** Revoga credenciais externas e apaga os segredos locais antes do Auth. */
export async function POST(request: Request) {
  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({message: 'Entre novamente para excluir a conta.'}, {status: 401});
  if (!takeRateLimit(`account-deletion:${uid}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({message: 'Muitas tentativas. Aguarde alguns minutos.'}, {status: 429});
  }

  try {
    const bluesky = await getConnection(uid, 'bluesky');
    const warnings: string[] = [];
    if (bluesky?.did) {
      await getBlueskyOAuthClient()
        .then((client) => client.revoke(bluesky.did!))
        .catch(() => warnings.push('bluesky-revoke-failed'));
    }
    await cleanupSocialData(uid);
    return NextResponse.json({ok: true, warnings});
  } catch (error) {
    console.error('Local social cleanup before account deletion failed:', error);
    return NextResponse.json({message: 'Nao foi possivel limpar as credenciais conectadas.'}, {status: 500});
  }
}
