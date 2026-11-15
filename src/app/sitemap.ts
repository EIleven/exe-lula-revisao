
// src/app/sitemap.ts
import { MetadataRoute } from 'next';
import { getDocs, collection, query, where, orderBy, limit, Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Post } from '@/lib/types';
import { siteConfig } from '@/config/site';

// Força a geração dinâmica para evitar cache estático e o erro sitemap-0.xml
export const dynamic = 'force-dynamic';

const BASE_URL = siteConfig.baseUrl;
const locales = ['pt-BR', 'en'];

// Helper to create a fully qualified, localized URL.
function createLocalizedUrl(path: string, locale: string): string {
  const finalPath = path === '/' ? '' : path;
  return `${BASE_URL}/${locale}${finalPath}`;
}

// Helper para criar uma entrada de sitemap com alternates
function createSitemapEntry(path: string, lastModified?: string | Date, priority: number = 0.7): MetadataRoute.Sitemap[0] {
  const alternates: { languages: { [key: string]: string } } = { languages: {} };
  
  locales.forEach(locale => {
    alternates.languages[locale] = createLocalizedUrl(path, locale);
  });

  // A URL principal (<loc>) DEVE ser a versão com o locale padrão.
  return {
    url: createLocalizedUrl(path, 'pt-BR'), 
    lastModified: lastModified || new Date().toISOString(),
    priority,
    alternates,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 1. Static pages
  const staticRoutes = [
    '/',
    '/about',
    '/terms',
    '/privacy',
    '/explore',
    '/trending',
  ].map((route) => createSitemapEntry(route, undefined, route === '/' ? 1.0 : 0.8));

  // 2. Perfis de usuários ficam fora do sitemap: a lista de membros não é entregue a robôs (listar users exige
  //    login), e cada perfil continua alcançável pelos links dos posts.

  // 3. Dynamic post pages
  let postPaths: MetadataRoute.Sitemap = [];
  try {
    // Só posts públicos e não apagados (as regras recusam listar sem o filtro de visibilidade).
    const postsQuery = query(collection(db, 'posts'), where('visibility', '==', 'public'), where('isDeleted', '==', false), orderBy('createdAt', 'desc'), limit(5000));
    const postSnapshot = await getDocs(postsQuery);
    
    postPaths = postSnapshot.docs.map(doc => {
      const post = { id: doc.id, ...doc.data() } as Post;
      const rawDateValue = post.updatedAt || post.createdAt;
      
      // Simplified and robust date handling for server-side Firestore Timestamps
      let dateObj: Date | null = null;
      if (rawDateValue && typeof (rawDateValue as any).toDate === 'function') {
        dateObj = (rawDateValue as FirestoreTimestamp).toDate();
      }

      if (!dateObj) {
        console.warn(`Skipping post ${post.id} in sitemap due to invalid or missing date.`);
        return null;
      }
      
      return createSitemapEntry(`/post/${post.id}`, dateObj.toISOString(), 0.7);
    }).filter((path): path is MetadataRoute.Sitemap[0] => path !== null);

  } catch (error) {
    console.error("Error fetching posts for sitemap:", error);
  }

  const allEntries = [...staticRoutes, ...postPaths];
  
  // Retornando uma única array de entradas impede o Next.js de criar um sitemap index.
  return allEntries;
}
