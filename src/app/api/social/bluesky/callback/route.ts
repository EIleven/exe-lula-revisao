import { Agent } from '@atproto/api';
import { NextResponse } from 'next/server';
import { siteConfig } from '@/config/site';
import { getBlueskyOAuthClient } from '@/lib/server/blueskyOAuth';
import { createLoginTicket, provisionOrLoginFederatedUser } from '@/lib/server/federatedAuth';
import { consumeLinkState, saveConnection } from '@/lib/server/socialStore';
import { socialSettingsUrl } from '@/lib/server/socialConfig';

export async function GET(request: Request) {
  let locale = 'pt-BR';
  try {
    const client = await getBlueskyOAuthClient();
    const { session, state } = await client.callback(new URL(request.url).searchParams);
    if (!state) throw new Error('missing application state');
    const link = await consumeLinkState(state, 'bluesky');
    if (!link) {
      await client.revoke(session.did).catch(() => undefined);
      throw new Error('invalid or expired application state');
    }
    locale = link.locale ?? locale;
    const agent = new Agent(session);
    const profile = await agent.getProfile({ actor: session.did });

    if (link.uid === '__login__') {
      const provisioned = await provisionOrLoginFederatedUser({
        provider: 'bluesky',
        externalId: session.did,
        handle: profile.data.handle,
        name: profile.data.displayName || profile.data.handle,
        bio: profile.data.description || '',
        avatarUrl: profile.data.avatar || '',
        coverImageUrl: profile.data.banner || '',
        website: `https://bsky.app/profile/${profile.data.handle}`,
        did: session.did,
        locale,
      });

      await saveConnection({
        uid: provisioned.uid,
        provider: 'bluesky',
        connected: true,
        did: session.did,
        handle: profile.data.handle,
        displayName: profile.data.displayName,
        avatarUrl: profile.data.avatar,
        connectedAt: new Date().toISOString(),
      });

      const ticket = await createLoginTicket(provisioned);
      const origin = siteConfig.baseUrl.replace(/\/+$/, '');
      return NextResponse.redirect(`${origin}/${locale}/login?ticket=${encodeURIComponent(ticket)}`);
    }

    await saveConnection({
      uid: link.uid,
      provider: 'bluesky',
      connected: true,
      did: session.did,
      handle: profile.data.handle,
      displayName: profile.data.displayName,
      avatarUrl: profile.data.avatar,
      connectedAt: new Date().toISOString(),
    });
    return NextResponse.redirect(socialSettingsUrl(locale, 'connected', 'bluesky'));
  } catch (error) {
    console.error('Bluesky OAuth callback failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.redirect(socialSettingsUrl(locale, 'error', 'bluesky'));
  }
}
