// src/lib/services/cacheService.ts
import Dexie, { type Table } from 'dexie';
import type { PollDraft, Post, PostLocation } from '@/lib/types';
import { getFeedActivityMillis } from '@/lib/feedUtils';
import { v4 as uuidv4 } from 'uuid';

export interface CachedPost extends Omit<Post, 'createdAt'> {
  cacheKey: string;
  scope: string;
  feedId: string;
  createdAt: number;
  activityAt: number;
}

export interface Draft extends Partial<Post> {
  id?: string;
  draftType: 'post' | 'news';
  location?: PostLocation | null;
  sensitive?: boolean;
  pollInput?: PollDraft | null;
  quotedPostObject?: Post | null;
  savedAt: number;
}

class CacheService extends Dexie {
  feedItems!: Table<CachedPost, string>;
  drafts!: Table<Draft, string>;

  constructor() {
    super('SoberanFeedCache');
    this.version(2).stores({
      posts: 'id, feedId, createdAt',
      drafts: 'id, draftType, savedAt',
    });
    // A tabela antiga tinha `id` como chave primária: o mesmo post em dois feeds se sobrescrevia e, pior, o cache não
    // separava usuários no mesmo aparelho. Ela é removida na migração; conteúdo protegido nunca volta ao cache local.
    this.version(3).stores({
      posts: null,
      feedItems: 'cacheKey, [scope+feedId], scope, feedId, activityAt',
      drafts: 'id, draftType, savedAt',
    });
  }

  private fromFirestoreTimestamp(ts: unknown): number {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') return new Date(ts).getTime();
    if (typeof ts === 'object' && ts !== null) {
      const timestamp = ts as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
      if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
      if (typeof timestamp.seconds === 'number') {
        return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds ?? 0) / 1_000_000);
      }
    }
    return Date.now();
  }

  private toClientPost(cachedPost: CachedPost): Post {
    const { cacheKey: _cacheKey, scope: _scope, feedId: _feedId, activityAt: _activityAt, ...post } = cachedPost;
    return { ...post, createdAt: new Date(cachedPost.createdAt).toISOString() };
  }

  private fromClientPost(post: Post, scope: string, feedId: string): CachedPost {
    return {
      ...post,
      cacheKey: JSON.stringify([scope, feedId, post.id]),
      scope,
      feedId,
      createdAt: this.fromFirestoreTimestamp(post.createdAt),
      activityAt: getFeedActivityMillis(post),
    };
  }

  async getFeedFromCache(scope: string, feedId: string): Promise<Post[]> {
    try {
      const cachedPosts = await this.feedItems
        .where('[scope+feedId]')
        .equals([scope, feedId])
        .sortBy('activityAt');
      return cachedPosts.reverse().map((post) => this.toClientPost(post));
    } catch (error) {
      console.error(`[CacheService] Failed to get feed "${feedId}" from cache:`, error);
      return [];
    }
  }

  async saveFeedToCache(scope: string, feedId: string, posts: Post[]): Promise<void> {
    // Conteúdo para seguidores não é persistido: se a pessoa deixar de seguir alguém, nada privado pisca na tela antes
    // da revalidação. O cache ainda acelera feeds públicos e mantém os estados personalizados isolados por conta.
    const cachedPosts = (posts ?? [])
      .filter((post) => post.visibility === 'public' && post.repostedComment?.postVisibility !== 'followers')
      .map((post) => this.fromClientPost(post, scope, feedId));
    try {
      await this.transaction('rw', this.feedItems, async () => {
        await this.feedItems.where('[scope+feedId]').equals([scope, feedId]).delete();
        if (cachedPosts.length > 0) await this.feedItems.bulkPut(cachedPosts);
      });
    } catch (error) {
      console.error(`[CacheService] Failed to save feed "${feedId}" to cache:`, error);
    }
  }

  async clearFeedCache(scope: string, feedId: string): Promise<void> {
    try {
      await this.feedItems.where('[scope+feedId]').equals([scope, feedId]).delete();
    } catch (error) {
      console.error(`[CacheService] Failed to clear cache for feed "${feedId}":`, error);
    }
  }

  // --- Draft Methods ---

  async saveDraft(draft: Omit<Draft, 'savedAt'>): Promise<string> {
    const draftToSave = {
      ...draft,
      id: draft.id || uuidv4(),
      savedAt: Date.now(),
    };
    await this.drafts.put(draftToSave);
    return draftToSave.id;
  }

  async getDrafts(type: 'post' | 'news'): Promise<Draft[]> {
    return this.drafts
      .where('draftType')
      .equals(type)
      .sortBy('savedAt')
      .then(drafts => drafts.reverse());
  }

  async getAllDrafts(): Promise<Draft[]> {
    return this.drafts.orderBy('savedAt').reverse().toArray();
  }

  async getDraft(id: string): Promise<Draft | undefined> {
    return this.drafts.get(id);
  }

  async deleteDraft(id: string): Promise<void> {
    return this.drafts.delete(id);
  }
}

export const cacheService = new CacheService();
