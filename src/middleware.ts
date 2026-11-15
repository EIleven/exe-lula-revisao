import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

const locales = ['pt-BR', 'en'];

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale: 'pt-BR'
});

// Só idioma (detecção e redirecionamento). O registro de visitas saiu daqui: o middleware chamava /api/log-access a
// cada página, com o IP no corpo (forjável) e um cookie de sessão só para rastrear visitante. Agora o navegador avisa
// a visita (telemetryService.logAccessEvent) e o servidor não guarda dado pessoal.
export default function middleware(request: NextRequest) {
  if (request.method === 'GET') {
    const accept = (request.headers.get('accept') || '').toLowerCase();
    const wantsAp = accept.includes('application/activity+json') || accept.includes('application/ld+json');
    if (wantsAp) {
      const match = request.nextUrl.pathname.match(/^\/(?:pt-BR|en)\/post\/([A-Za-z0-9_-]+)\/?$/);
      if (match?.[1]) {
        return NextResponse.rewrite(new URL(`/ap/notes/${match[1]}`, request.url));
      }
    }
  }
  return intlMiddleware(request);
}

export const config = {
  // Match only internationalized pathnames
  // /download is also a public entry point documented for the Android app;
  // let next-intl redirect it to the visitor's locale instead of returning 404.
  matcher: ['/', '/download', '/(pt-BR|en)/:path*']
};
