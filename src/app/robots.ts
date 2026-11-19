import { type MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

const locales = ['pt-BR', 'en'];

export default function robots(): MetadataRoute.Robots {
  const sitemapUrl = `${siteConfig.baseUrl}/sitemap.xml`;

  // Disallow crawling of paths that are not useful for indexing,
  // such as API routes, user-specific pages, and internal assets.
  // This is friendly to all bots, including AI crawlers, as it allows
  // them to focus on public-facing content.
  //
  // As rotas do app vivem sob o prefixo de idioma (/pt-BR/login, /en/login...), então cada caminho
  // privado é bloqueado com e sem prefixo. /api/ e /offline existem apenas na raiz.
  const privatePaths = [
    '/login',
    '/register',
    '/settings',
    '/messages',
    '/notifications',
    '/drafts',
    '/bookmarks',
    '/files',
    '/breaknews',
    '/keys',
    '/share',
    '/admin',
  ];
  const disallowPaths = [
    '/api/',
    '/offline',
    ...privatePaths,
    ...locales.flatMap((locale) => privatePaths.map((path) => `/${locale}${path}`)),
  ];

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: disallowPaths,
    },
    sitemap: sitemapUrl,
  };
}
