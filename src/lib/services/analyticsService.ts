// src/lib/services/analyticsService.ts
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getPostById } from './postReadService';
import { markerExpiryMillis } from '@/lib/analytics/markerExpiry';

const VIEW_PERSISTENT_KEY = 'viewed_posts_persistent';

export interface PostAnalyticsData {
  impressions: number;
  totalEngagements: number;
  profileClicks: number;
  dailyViewsData: { date: string; views: number }[];
}

/**
 * Tracks a click on the author's profile from a specific post.
 * @param postId The ID of the post from which the profile was clicked.
 */
export const trackProfileClick = async (postId: string): Promise<void> => {
  const userId = auth.currentUser?.uid;
  if (!postId || !userId) return;
  if (alreadyTracked(CLICK_PERSISTENT_KEY, postId)) return;
  try {
    // Um marcador por pessoa (profileClicks/{uid}); o número em analytics/summary é gravado pela Function
    // onProfileClickedFromPost. Antes qualquer usuário somava +1 na análise de qualquer post.
    // `expireAt` faz o TTL do Firestore apagar o marcador em 90 dias: fica o agregado, não o rastro de quem clicou.
    await setDoc(doc(db, `posts/${postId}/profileClicks/${userId}`), {
      createdAt: serverTimestamp(),
      expireAt: Timestamp.fromMillis(markerExpiryMillis()),
    });
  } catch {
    // Já registrado antes (a regra não deixa regravar): nada a fazer.
  }
};

const CLICK_PERSISTENT_KEY = 'profile_clicks_persistent';
const TRACK_MEMORY_DAYS = 30;

/** Memória local para não repetir gravações que a regra recusaria (cada pessoa conta uma vez por post). */
function alreadyTracked(storageKey: string, postId: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const now = Date.now();
    const seen: Record<string, number> = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (seen[postId] && now - seen[postId] < TRACK_MEMORY_DAYS * 24 * 3600 * 1000) return true;
    seen[postId] = now;
    // Limite de tamanho: guarda só os 500 mais recentes.
    const entries = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 500);
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
    return false;
  } catch {
    return false;
  }
}


/**
 * Tracks a view for a given post, ensuring a user doesn't trigger multiple views in a short time.
 * Uses sessionStorage for anonymous users and localStorage for logged-in users for better persistence.
 * @param postId The ID of the post being viewed.
 * @param userId The ID of the logged-in user, if any.
 */
export const trackPostView = async (postId: string, userId?: string | null): Promise<void> => {
  // Visualizações contam pessoas logadas únicas (views/{uid}); anônimos não gravam nada.
  if (!userId || !postId || typeof window === 'undefined') return;
  if (alreadyTracked(VIEW_PERSISTENT_KEY, postId)) return;
  try {
    // O contador "views" do post e a série diária em analytics/summary são gravados pela Function onPostViewed.
    // `expireAt` faz o TTL do Firestore apagar o marcador em 90 dias: fica o agregado, não o rastro de quem viu.
    await setDoc(doc(db, `posts/${postId}/views/${userId}`), {
      createdAt: serverTimestamp(),
      expireAt: Timestamp.fromMillis(markerExpiryMillis()),
    });
  } catch {
    // Já visto antes (a regra não deixa regravar) ou post inacessível: nada a fazer.
  }
};

/**
 * Retrieves and calculates analytics data for a specific post.
 * @param postId The ID of the post to get analytics for.
 * @returns A promise that resolves to the post's analytics data, or null if the post is not found.
 */
export const getPostAnalytics = async (postId: string): Promise<PostAnalyticsData | null> => {
  if (!postId) {
    console.error("[AnalyticsService] getPostAnalytics called with no postId.");
    return null;
  }
  
  const post = await getPostById(postId);
  if (!post) {
    // Post not found or user doesn't have permission. Don't throw, just return null.
    return null;
  }

  const analyticsRef = doc(db, `posts/${postId}/analytics/summary`);
  const analyticsSnap = await getDoc(analyticsRef);
  const analyticsData = analyticsSnap.data();

  const totalEngagements = (post.likes || 0) + (post.commentsCount || 0) + (post.quotesCount || 0) + (post.reposts || 0);
  
  // The "impressions" metric now directly reflects the "views" count.
  const impressions = post.views || 0;
  const profileClicks = analyticsData?.profileClicks || 0;

  let dailyViewsData: { date: string; views: number }[] = [];
  if (analyticsSnap.exists()) {
    const dailyViewsMap = analyticsData.dailyViews || {};
    dailyViewsData = Object.entries(dailyViewsMap)
      .map(([date, views]) => ({ date, views: views as number }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  return {
    impressions,
    totalEngagements,
    profileClicks,
    dailyViewsData,
  };
};
