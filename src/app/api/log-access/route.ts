// src/app/api/log-access/route.ts
// Registro de acesso a páginas (contagens do painel do administrador). Grava SÓ o necessário para as contagens
// diárias (caminho, tipo de público, região aproximada e hora do servidor): nada de IP, navegador, sessão ou usuário
// (minimização de dados, LGPD). A região sai do IP em memória e o IP é descartado. A gravação é feita pelo Admin SDK:
// as regras do Firestore não deixam ninguém criar eventos direto (antes qualquer pessoa, sem login, criava eventos
// falsos, e o IP vinha do corpo da requisição, forjável).
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveIp } from '@/lib/services/geoService';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

const EVENTS_PER_WINDOW = 20;
const EVENT_WINDOW_MS = 10 * 1000;
const AUDIENCES = new Set(['auth', 'guest']);

export async function POST(request: NextRequest) {
  try {
    const ip = requestIp(request);
    if (!takeRateLimit(`access:${ip}`, EVENTS_PER_WINDOW, EVENT_WINDOW_MS)) {
      return NextResponse.json({ message: 'Too many requests.' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const rawPath = typeof body?.path === 'string' ? body.path : '';
    const path = rawPath.split(/[?#]/)[0].slice(0, 300); // sem parâmetros (podem carregar dados pessoais)
    const audienceType = typeof body?.audienceType === 'string' ? body.audienceType : '';
    if (!path.startsWith('/') || !AUDIENCES.has(audienceType)) {
      return NextResponse.json({ message: 'Invalid event data.' }, { status: 400 });
    }

    const geo = resolveIp(ip);
    await adminFirestore().collection('access_events').add({
      path,
      audienceType,
      geo: {
        countryCode: geo?.countryCode ?? null,
        countryName: geo?.countryName ?? null,
        stateCode: geo?.stateCode ?? null,
        stateName: geo?.stateName ?? null,
        city: geo?.city ?? null,
      },
      serverTimestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ message: 'Event logged.' }, { status: 202 });
  } catch (error) {
    console.error('Error logging access event:', error);
    return NextResponse.json({ message: 'Internal Server Error.' }, { status: 500 });
  }
}
