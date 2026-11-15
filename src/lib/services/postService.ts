// src/lib/services/postService.ts
import { db } from '../firebase'; // db é exportado de firebase.ts
import { collection } from 'firebase/firestore'; // collection é importado diretamente de firebase/firestore

// Definição comum da coleção de posts
export const postsCollection = collection(db, 'posts');

// Reexportar tudo dos serviços de leitura e escrita de posts
export * from './postReadService';
export * from './posts'; // Alterado de ./postWriteService para ./posts (que tem seu próprio index.ts)
