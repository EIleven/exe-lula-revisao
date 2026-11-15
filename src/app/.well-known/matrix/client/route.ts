import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Descoberta padrão Matrix Client-Server (`/.well-known/matrix/client`).
 * Permite que clientes Matrix (Element, Cinny, FluffyChat) descubram o homeserver configurado para o domínio.
 */
export async function GET() {
  const baseUrl = (process.env.MATRIX_HOMESERVER_URL || 'https://matrix.org').replace(/\/+$/, '');
  return NextResponse.json(
    {
      'm.homeserver': {
        base_url: baseUrl,
      },
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
}

