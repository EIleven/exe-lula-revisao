'use client';

import type { SocialConnectionsStatus, SocialProvider, SocialPublishResult } from './types';
import type { User as FirebaseUser } from 'firebase/auth';

async function authenticatedFetch(firebaseUser: FirebaseUser, input: string, init: RequestInit = {}) {
  const token = await firebaseUser.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(input, { ...init, headers, cache: 'no-store' });
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.message === 'string' ? body.message : 'A rede externa não respondeu como esperado.');
  }
  return body as T;
}

export async function getSocialConnections(firebaseUser: FirebaseUser): Promise<SocialConnectionsStatus> {
  return readJson(await authenticatedFetch(firebaseUser, '/api/social/status'));
}

export async function startSocialConnection(
  firebaseUser: FirebaseUser,
  provider: SocialProvider,
  handle?: string,
  locale?: string,
): Promise<string> {
  const response = await authenticatedFetch(firebaseUser, `/api/social/${provider}/start`, {
    method: 'POST',
    body: JSON.stringify({ ...(handle ? { handle } : {}), locale }),
  });
  return (await readJson<{ url: string }>(response)).url;
}

export async function disconnectSocialConnection(firebaseUser: FirebaseUser, provider: SocialProvider): Promise<void> {
  await readJson(await authenticatedFetch(firebaseUser, '/api/social/disconnect', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  }));
}

export async function publishPostToSocialNetworks(
  firebaseUser: FirebaseUser,
  postId: string,
  providers: SocialProvider[],
  locale: string,
): Promise<SocialPublishResult[]> {
  const response = await authenticatedFetch(firebaseUser, '/api/social/publish', {
    method: 'POST',
    body: JSON.stringify({ postId, providers, locale }),
  });
  return (await readJson<{ results: SocialPublishResult[] }>(response)).results;
}
