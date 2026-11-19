// src/app/[locale]/post/[postId]/page.tsx
import { getPostById } from '@/lib/services/postReadService';
import type { Metadata, ResolvingMetadata } from 'next';
import PostPageClientContent from './PostPageClientContent';
import { siteConfig } from '@/config/site';
import { notFound } from 'next/navigation';
import { isPublicSafe } from '@/lib/feed/publicVisibility';
import { extractFirstMediaFromHtml } from '@/lib/utils/textUtils';
import { Fragment } from 'react';
import type { Post } from '@/lib/types';
import { getCurrentUserId } from '@/lib/services/authService';
import JsonLd from '@/components/shared/JsonLd';
import type { WithContext } from 'schema-dts';
import { NewsArticle, SocialMediaPosting } from 'schema-dts';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cache } from 'react';

// O servidor monta a página SEM login: só lê posts públicos. Post "só para seguidores" (perfil privado) não pode
// virar 404 (antes até o dono e os seguidores viam "Página não encontrada"): a página carrega no navegador, com o
// login de quem abriu. 404 de verdade só quando o post não existe.
// cache(): os metadados e a página compartilham as mesmas leituras no mesmo pedido (antes o post era lido duas vezes).
const loadPublicPost = cache((postId: string) => getPostById(postId, null));
const isMissingPost = cache(async (postId: string): Promise<boolean> => {
  try {
    return !(await getDoc(doc(db, 'posts', postId))).exists();
  } catch {
    return false; // sem permissão (restrito) ou falha passageira: o navegador tenta com o login
  }
});

type Props = {
  params: { postId: string, locale: string };
};

// Function to safely extract a description.
const getSafeDescription = (post: Post, siteName: string): string => {
    let description = post.text?.replace(/<[^>]*>?/gm, ' ') || ''; // Strip HTML tags for description
    description = description.trim();
    
    if (description.length > 155) {
        description = description.substring(0, 152) + '...';
    } else if (!description) {
        description = `View the post by ${post.user.name} on ${siteName}.`;
    }
    return description;
}

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { postId, locale } = params;
  const post = await loadPublicPost(postId);

  // Conteúdo com aviso, ou fora do português, não vai para buscador nem para prévia de link: é a mesma vitrine do feed
  // (lib/feed/publicVisibility.ts). Quem tem conta continua abrindo normalmente, pelo caminho do navegador.
  if (!post || post.isDeleted || !isPublicSafe(post) || (post.visibility === 'private' && post.userId !== getCurrentUserId())) {
    // Sem título nem texto do post: se ele for restrito, nada do conteúdo vaza para buscadores e prévias de link.
    // O noindex vale também para o post que não existe: a resposta sai com HTTP 200 (o conteúdo das páginas só é
    // montado no navegador, o AppLayout mostra o esqueleto até montar, e o notFound() do Next nem o dos metadados
    // chegam ao servidor), então é ele que impede os buscadores de indexar a página de erro.
    return {
      title: !post && (await isMissingPost(postId)) ? 'Página não encontrada' : 'Post',
      description: siteConfig.description,
      robots: { index: false, follow: false },
    };
  }

  const siteName = siteConfig.name;
  const postUrl = `${siteConfig.baseUrl}/${locale}/post/${postId}`;
  
  const title = post.headline || post.user.name + ` on HiperVerso: "${(post.text || '').replace(/<[^>]*>?/gm, ' ').substring(0, 50)}..."`;
  const description = getSafeDescription(post, siteName);

  let imageUrl: string | null = null;
  if (post.media && post.media.length > 0 && post.media[0].type === 'image') {
    imageUrl = post.media[0].url;
  } else if (post.youtubeVideoId) {
    imageUrl = `https://img.youtube.com/vi/${post.youtubeVideoId}/hqdefault.jpg`;
  } else if (post.text) {
    imageUrl = extractFirstMediaFromHtml(post.text);
  }

  // Sem imagem própria (post de texto), a prévia do link nas outras redes mostrava só a logo genérica do HiperVerso.
  // Agora mostra o PRÓPRIO post desenhado no visual da rede (autor, texto e marca) — /api/post-image só monta isso
  // para post público; o restrito continua caindo na imagem da marca.
  const ogImage = imageUrl ? imageUrl : `${siteConfig.baseUrl}/api/post-image/${postId}`;

  const openGraphData: Metadata['openGraph'] = {
    title,
    description,
    url: postUrl,
    siteName,
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: post.headline || title,
      },
    ],
    locale: 'pt_BR', 
  };
  
  // Add article-specific OG tags if it's a news post
  if (post.category === 'news') {
    openGraphData.type = 'article';
    openGraphData.authors = [post.user.name];
    if (post.createdAt) {
      openGraphData.publishedTime = new Date(post.createdAt).toISOString();
    }
    if (post.updatedAt) {
      openGraphData.modifiedTime = new Date(post.updatedAt).toISOString();
    }
  } else {
    openGraphData.type = 'website';
  }

  return {
    title,
    description,
    alternates: {
      canonical: postUrl,
      types: {
        'application/activity+json': `${siteConfig.baseUrl}/ap/notes/${postId}`,
      },
    },
    openGraph: openGraphData,
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
      creator: `@${post.user.username}`,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    verification: {
      google: 'GOePk6RQvTH2ZlNFkQmqtHKF6Sd78GWTx83xHqBcuRc',
    },
  };
}

export default async function SinglePostPage({ params }: Props) {
  const post = await loadPublicPost(params.postId);
  if (!post || !isPublicSafe(post)) {
    if (!post && (await isMissingPost(params.postId))) notFound();
    // Restrito (ou com aviso de conteúdo): sem JSON-LD e sem texto no HTML. O navegador busca de novo com o login.
    return <PostPageClientContent />;
  }

  let jsonLd: WithContext<NewsArticle | SocialMediaPosting>;

  if (post.category === 'news') {
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `${siteConfig.baseUrl}/${params.locale}/post/${params.postId}`,
      },
      headline: post.headline || post.text?.substring(0, 110) || '',
      image: [
        post.media?.[0]?.url || extractFirstMediaFromHtml(post.text) || `${siteConfig.baseUrl}/exe-lula-og.png`
      ],
      datePublished: post.createdAt ? new Date(post.createdAt).toISOString() : new Date().toISOString(),
      dateModified: post.updatedAt ? new Date(post.updatedAt).toISOString() : new Date(post.createdAt).toISOString(),
      author: {
        '@type': 'Person',
        'name': post.user.name,
        'url': `${siteConfig.baseUrl}/${params.locale}/profile/${post.user.id}`
      },
      publisher: {
        '@type': 'Organization',
        'name': 'HiperVerso',
        'logo': {
          '@type': 'ImageObject',
          'url': `${siteConfig.baseUrl}/favicon.ico`
        }
      },
      description: getSafeDescription(post, siteConfig.name),
    };
  } else { // 'echo' or other types
    jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'SocialMediaPosting',
        headline: post.text?.substring(0, 50) || 'HiperVerso Post',
        articleBody: post.text?.replace(/<[^>]*>?/gm, ' ') || '',
        author: {
            '@type': 'Person',
            'name': post.user.name,
            'url': `${siteConfig.baseUrl}/${params.locale}/profile/${post.user.id}`
        },
        datePublished: post.createdAt ? new Date(post.createdAt).toISOString() : new Date().toISOString(),
        dateModified: post.updatedAt ? new Date(post.updatedAt).toISOString() : new Date(post.createdAt).toISOString(),
        publisher: {
            '@type': 'Organization',
            'name': 'HiperVerso',
        },
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': `${siteConfig.baseUrl}/${params.locale}/post/${params.postId}`,
        },
    };
  }

  return (
      <Fragment>
        <JsonLd data={jsonLd} />
        <PostPageClientContent />
      </Fragment>
  );
}
