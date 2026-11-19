// src/lib/server/deviceLogin.ts
// Protocolo de login por dispositivo conectado (Chave Soberana): entrar digitando @fulano@hiperverso.social (ou .app) gera um desafio
// efêmero que avisa em tempo real os aparelhos JÁ conectados da conta; um deles aprova digitando o código da tela do aparelho
// novo. A lógica toda está em deviceLoginCore.ts (sem Firebase, testada com um banco de mentira); aqui só se liga ao mundo real.
// Nunca importar em código do navegador.
import { adminDatabase, adminFirestore, adminMessaging } from '@/lib/server/firebaseAdmin';
import { siteConfig } from '@/config/site';
import { mintClientAuthCredential } from '@/lib/server/clientCredential';
import { localUserIdOfHandle } from '@/lib/server/localIdentity';
import { takeRateLimit } from '@/lib/server/requestAuth';
import {
  listPending,
  pollChallenge,
  respondChallenge,
  startChallenge,
  type DbLike,
  type DeviceLoginChallengePublic,
  type DeviceLoginDeps,
  type PollResult,
  type RespondResult,
  type StartResult,
} from '@/lib/server/deviceLoginCore';

export type { DeviceLoginChallengePublic, DeviceLoginStatus } from '@/lib/server/deviceLoginCore';

const LOCAL_DOMAINS: ReadonlySet<string> = new Set(
  [
    'hiperverso.social',
    'hiperverso.app',
    'www.hiperverso.app',
    'exercitodolula.app',
    'www.exercitodolula.app',
    (process.env.NEXT_PUBLIC_SITE_DOMAIN || '').toLowerCase(),
  ].filter(Boolean),
);

async function sendLoginSecurityPush(uid: string, payload: DeviceLoginChallengePublic): Promise<void> {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') return;
  try {
    const db = adminFirestore();
    const snap = await db.collection(`users/${uid}/fcmTokens`).get();
    if (snap.empty) return;

    const byLocale = new Map<'pt-BR' | 'en', string[]>();
    for (const d of snap.docs) {
      const loc = String(d.get('locale') || '').toLowerCase().startsWith('en') ? 'en' : 'pt-BR';
      const list = byLocale.get(loc) ?? [];
      list.push(d.id);
      byLocale.set(loc, list);
    }

    const origin = siteConfig.officialOrigin.replace(/\/+$/, '');
    const messaging = adminMessaging();

    for (const [locale, tokens] of byLocale.entries()) {
      const isEn = locale === 'en';
      const title = isEn ? 'Sign-in request · HiperVerso' : 'Pedido de entrada · HiperVerso';
      const body = isEn
        ? `${payload.requesterDeviceLabel} (${payload.requesterIpHint}) wants to sign in. Tap to approve.`
        : `${payload.requesterDeviceLabel} (${payload.requesterIpHint}) pediu para entrar. Toque para aprovar.`;
      const path = `/${locale}/keys`;
      const link = `${origin}${path}`;
      const tag = `login_request:${payload.challengeId}`;

      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: {
          url: link,
          path,
          type: 'login_request',
          notificationId: payload.challengeId,
          tag,
        },
        android: {
          priority: 'high',
          collapseKey: tag.slice(0, 64),
          notification: {
            channelId: 'exelula_security',
            tag,
            sound: 'default',
            defaultVibrateTimings: true,
            visibility: 'private',
            priority: 'high',
            ticker: `${title}: ${body}`,
            icon: 'ic_stat_notify',
            color: '#D61F26',
          },
        },
        webpush: {
          headers: { Urgency: 'high', TTL: '300' },
          notification: {
            icon: `${origin}/icons/icon-192.png`,
            badge: `${origin}/icons/icon-192.png`,
            tag,
            renotify: true,
          },
          fcmOptions: { link },
        },
      });

      const stale: Promise<unknown>[] = [];
      res.responses.forEach((r, idx) => {
        const code = r.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          stale.push(db.doc(`users/${uid}/fcmTokens/${tokens[idx]}`).delete().catch(() => undefined));
        }
      });
      if (stale.length > 0) await Promise.all(stale);
    }
  } catch (err) {
    console.warn('[deviceLogin] Falha ao enviar push de segurança:', err instanceof Error ? err.message : String(err));
  }
}

async function mirrorChallengeToRtdb(uid: string, payload: DeviceLoginChallengePublic | null, challengeId: string): Promise<void> {
  try {
    const ref = adminDatabase().ref(`p2pDeviceSync/${uid}/loginRequests/${challengeId}`);
    if (payload === null) await ref.remove();
    else {
      await ref.set(payload);
      if (payload.status === 'pending') {
        void sendLoginSecurityPush(uid, payload);
      }
    }
  } catch (err) {
    // O RTDB é só o aviso instantâneo; o Firestore continua sendo a verdade e o aparelho que aprova também consulta /pending.
    console.warn('[deviceLogin] Falha ao espelhar desafio no RTDB:', err instanceof Error ? err.message : String(err));
  }
}

function realDeps(): DeviceLoginDeps {
  return {
    db: adminFirestore() as unknown as DbLike,
    now: () => Date.now(),
    mint: (uid, claims) => mintClientAuthCredential(uid, claims),
    mirror: mirrorChallengeToRtdb,
    resolveAccount: async (localHandle) => {
      const uid = await localUserIdOfHandle(localHandle);
      if (!uid) return null;
      const userSnap = await adminFirestore().collection('users').doc(uid).get();
      const data = userSnap.exists ? userSnap.data() : undefined;
      const username = (typeof data?.username === 'string' && data.username.trim()) || localHandle;
      const name = (typeof data?.name === 'string' && data.name.trim()) || username;
      return { uid, username, name, avatarUrl: typeof data?.avatarUrl === 'string' ? data.avatarUrl : '' };
    },
    takeRateLimit,
    localDomains: LOCAL_DOMAINS,
    log: (level, message, detail) => (level === 'error' ? console.error(message, detail ?? '') : console.warn(message, detail ?? '')),
  };
}

export const startDeviceLoginChallenge = (input: {
  handle: string;
  requesterDeviceId: string;
  requesterDeviceLabel: string;
  requesterIp: string;
}): Promise<StartResult> => startChallenge(realDeps(), input);

export const pollDeviceLoginChallenge = (input: { challengeId: string; secretToken: string }): Promise<PollResult> =>
  pollChallenge(realDeps(), input);

export const respondDeviceLoginChallenge = (input: {
  challengeId: string;
  uid: string;
  action: 'approve' | 'reject';
  verificationCode?: unknown;
  approverDeviceId: string;
  approverDeviceLabel: string;
}): Promise<RespondResult> => respondChallenge(realDeps(), input);

export const listPendingDeviceLoginChallenges = (uid: string): Promise<DeviceLoginChallengePublic[]> => listPending(realDeps(), uid);
