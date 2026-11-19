// src/app/api/v1/instance/route.ts
// Metadados públicos da instância no padrão compatível com Mastodon / Fediverso (somente leitura).
import { NextResponse } from 'next/server';
import { federation } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const f = federation();
  const plataforma = await f.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) {
    return new NextResponse(null, { status: 404 });
  }

  const metricas = await f.store.federationCounts();
  const origin = f.origin.replace(/\/+$/, '');
  const domain = origin.replace(/^https?:\/\//i, '');

  const payload = {
    uri: domain,
    domain,
    title: 'HiperVerso · HiperVerso',
    short_description:
      'Comunidade brasileira independente focada em soberania digital, diálogo público e comunicação direta P2P/ActivityPub (código próprio em Next.js/TypeScript).',
    description:
      'Projeto comunitário e independente brasileiro mantido por Breno Ramos (sem vínculo oficial partidário ou governamental). Arquitetura própria em TypeScript/Next.js com suporte a ActivityPub, E2EE e P2P WebRTC — não é fork de Misskey nem de Mastodon. Auditoria técnica e PRs abertos em https://github.com/EIleven/exe-lula-revisao.',
    email: 'brenobarros11@hotmail.com',
    version: f.render.softwareVersion || '1.0.0',
    source_url: 'https://github.com/EIleven/exe-lula-revisao',
    urls: {
      about: `${origin}/pt-BR/about`,
      dev: `${origin}/pt-BR/dev`,
      privacy: `${origin}/pt-BR/privacy`,
      terms: `${origin}/pt-BR/terms`,
    },
    stats: {
      user_count: metricas.accounts,
      status_count: metricas.publicObjects,
      domain_count: 0,
    },
    registrations: false,
    approval_required: false,
    invites_enabled: false,
    contact: {
      email: 'brenobarros11@hotmail.com',
      account: {
        id: 'qdnRsBvLG8NdwrLv9GwiHDa1xi42',
        username: 'breno',
        acct: `breno@${domain}`,
        display_name: 'Breno César',
        url: `${origin}/pt-BR/profile/qdnRsBvLG8NdwrLv9GwiHDa1xi42`,
      },
    },
    rules: [
      {
        id: '1',
        text: 'Respeito mútuo: proibidos assédio, ataques pessoais, discurso de ódio ou doxxing.',
      },
      {
        id: '2',
        text: 'Combate ativo a golpes, spam automatizado, falsidade ideológica e desinformação coordenada.',
      },
      {
        id: '3',
        text: 'Projeto comunitário independente e aberto à auditoria técnica e revisão de segurança.',
      },
    ],
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=900',
    },
  });
}

