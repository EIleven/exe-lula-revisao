// src/lib/services/adminService.ts
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp, orderBy, limit as firestoreLimit, collectionGroup } from 'firebase/firestore';
import { getPostById } from './postReadService';
import { getUser, getAllUsers } from './userService';
import type { Post, User } from '../types';
import { postsCollection } from './postService';

export interface TimeSeriesData {
  date: string;
  count: number;
}

export interface AdminAnalytics {
  newUsers: TimeSeriesData[];
  newPosts: TimeSeriesData[];
}

export interface PageViewData {
  date: string;
  guests: number;
  auth: number;
  total: number;
}

export interface TopRouteData {
  path: string;
  totalViews: number;
  guestViews: number;
  authViews: number;
}

export interface CountryViewData {
    countryCode: string;
    countryName: string; 
    views: number;
    guestViews: number;
    authViews: number;
}

export interface TopStateData {
  stateCode: string;
  stateName: string;
  views: number;
  guestViews: number;
  authViews: number;
}

export interface TopCityData {
  city: string;
  views: number;
  guestViews: number;
  authViews: number;
}

export interface TopPostViewData {
    postId: string;
    path: string;
    totalViews: number;
    guestViews: number;
    authViews: number;
    postDetails?: Post;
}


/**
 * Fetches analytics data for the admin dashboard.
 * NOTE: This is a simplified implementation for demonstration. A production
 * system would require pre-aggregated data (e.g., via Cloud Functions)
 * for performance, especially for larger date ranges.
 * @param range The time range to fetch data for.
 * @returns A promise that resolves to the analytics data.
 */
export const getAdminDashboardAnalytics = async (range: '7d' | '30d' = '7d'): Promise<AdminAnalytics> => {
    const days = range === '7d' ? 7 : 30;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));
    startDate.setHours(0,0,0,0);

    const analytics: AdminAnalytics = {
        newUsers: [],
        newPosts: [],
    };

    const dateMapUsers = new Map<string, number>();
    const dateMapPosts = new Map<string, number>();
    for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const dateKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dateMapUsers.set(dateKey, 0);
        dateMapPosts.set(dateKey, 0);
    }
    
    const usersQuery = query(
        collection(db, 'users'),
        where('createdAt', '>=', Timestamp.fromDate(startDate)),
        where('createdAt', '<=', Timestamp.fromDate(endDate))
    );
     const postsQuery = query(
        collection(db, 'posts'),
        where('createdAt', '>=', Timestamp.fromDate(startDate)),
        where('createdAt', '<=', Timestamp.fromDate(endDate))
    );

    try {
        const [usersSnapshot, postsSnapshot] = await Promise.all([
            getDocs(usersQuery),
            getDocs(postsQuery),
        ]);

        usersSnapshot.forEach(doc => {
            const createdAt = (doc.data().createdAt as Timestamp).toDate();
            const dateKey = createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            dateMapUsers.set(dateKey, (dateMapUsers.get(dateKey) || 0) + 1);
        });

        postsSnapshot.forEach(doc => {
            const createdAt = (doc.data().createdAt as Timestamp).toDate();
            const dateKey = createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            dateMapPosts.set(dateKey, (dateMapPosts.get(dateKey) || 0) + 1);
        });

        analytics.newUsers = Array.from(dateMapUsers.entries()).map(([date, count]) => ({ date, count }));
        analytics.newPosts = Array.from(dateMapPosts.entries()).map(([date, count]) => ({ date, count }));

    } catch (error) {
        console.error(`Failed to fetch analytics for range ${range}:`, error);
    }

    return analytics;
};

export type AdminRange = '7d' | '30d' | '90d';

const daysOfRange = (range: AdminRange): number =>
  range === '90d' ? 90 : range === '30d' ? 30 : 7;

export const getPageViewsAnalytics = async (range: AdminRange = '7d'): Promise<PageViewData[]> => {
    const days = daysOfRange(range);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));
    startDate.setHours(0,0,0,0);

    const dateStrings = Array.from({ length: days }, (_, i) => {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        return d.toISOString().split('T')[0];
    });
    const startStr = dateStrings[0];
    const endStr = dateStrings[dateStrings.length - 1];

    const q = query(
        collection(db, 'access_agg_daily'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );

    const viewCountsByDate = new Map<string, { guests: number; auth: number }>();
    dateStrings.forEach(dateStr => {
        const d = new Date(dateStr);
        d.setUTCHours(12);
        const formattedDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
        viewCountsByDate.set(formattedDate, { guests: 0, auth: 0 });
    });

    try {
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const data = doc.data();
            const d = new Date(data.date);
            d.setUTCHours(12);
            const formattedDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

            if (viewCountsByDate.has(formattedDate)) {
                const current = viewCountsByDate.get(formattedDate)!;
                if (data.audienceType === 'guest') {
                    current.guests += data.count;
                } else if (data.audienceType === 'auth') {
                    current.auth += data.count;
                }
            }
        });

        return Array.from(viewCountsByDate.entries()).map(([date, counts]) => ({
            date,
            ...counts,
            total: counts.guests + counts.auth,
        }));
    } catch (error) {
        console.error('Error fetching page view analytics:', error);
        return [];
    }
};

export const getTopRoutesAnalytics = async (range: AdminRange = '7d'): Promise<TopRouteData[]> => {
    const days = daysOfRange(range);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const q = query(
        collection(db, 'access_agg_daily'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );

    const pathAggregations = new Map<string, { totalViews: number; guestViews: number; authViews: number }>();

    try {
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const data = doc.data();
            const path = data.path || '/';
            const count = data.count || 0;
            const audienceType = data.audienceType || 'guest';

            const current = pathAggregations.get(path) || { totalViews: 0, guestViews: 0, authViews: 0 };
            
            current.totalViews += count;
            if (audienceType === 'guest') {
                current.guestViews += count;
            } else {
                current.authViews += count;
            }

            pathAggregations.set(path, current);
        });

        const results = Array.from(pathAggregations.entries()).map(([path, counts]) => ({
            path,
            ...counts
        }));

        return results.sort((a, b) => b.totalViews - a.totalViews).slice(0, 12);

    } catch (error) {
        console.error('Error fetching top routes analytics:', error);
        return [];
    }
};

export const getCountryAnalytics = async (range: AdminRange = '7d'): Promise<CountryViewData[]> => {
    const days = daysOfRange(range);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const q = query(
        collection(db, 'access_agg_daily'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );

    const countryAggregations = new Map<string, { authViews: number; guestViews: number; countryName: string }>();

    try {
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const data = doc.data();
            const countryCode = data.countryCode;
            if (!countryCode) return; 

            const count = data.count || 0;
            const audienceType = data.audienceType || 'guest';
            const countryName = data.countryName || countryCode;

            const current = countryAggregations.get(countryCode) || { authViews: 0, guestViews: 0, countryName: countryName };
            
            if (audienceType === 'auth') {
                current.authViews += count;
            } else {
                current.guestViews += count;
            }
            
            countryAggregations.set(countryCode, current);
        });
        
        const results = Array.from(countryAggregations.entries()).map(([code, counts]) => ({
            countryCode: code,
            countryName: counts.countryName,
            ...counts,
            views: counts.authViews + counts.guestViews,
        }));
        
        return results.sort((a, b) => b.views - a.views).slice(0, 15);

    } catch (error) {
        console.error('Error fetching country analytics:', error);
        return [];
    }
};

export const getTopStatesAnalytics = async (range: AdminRange, countryCode: string): Promise<TopStateData[]> => {
    const days = daysOfRange(range);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const q = query(
        collection(db, 'access_agg_daily'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );

    const stateAggregations = new Map<string, { views: number; guestViews: number; authViews: number; stateName: string }>();

    try {
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.countryCode !== countryCode) return;
            const stateCode = data.stateCode;
            if (!stateCode) return;
            
            const stateName = data.stateName || stateCode;
            const current = stateAggregations.get(stateCode) || { views: 0, guestViews: 0, authViews: 0, stateName: stateName };
            const count = data.count || 0;
            
            current.views += count;
            if (data.audienceType === 'guest') {
                current.guestViews += count;
            } else {
                current.authViews += count;
            }
            stateAggregations.set(stateCode, current);
        });
        
        const results = Array.from(stateAggregations.entries()).map(([code, counts]) => ({
            stateCode: code,
            stateName: counts.stateName,
            ...counts
        }));
        
        return results.sort((a, b) => b.views - a.views).slice(0, 15);

    } catch (error) {
        console.error(`Error fetching top states for ${countryCode}:`, error);
        return [];
    }
};

export const getTopCitiesAnalytics = async (range: AdminRange, countryCode: string, stateCode: string): Promise<TopCityData[]> => {
    const days = daysOfRange(range);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const q = query(
        collection(db, 'access_agg_daily'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );

    const cityAggregations = new Map<string, { views: number; guestViews: number; authViews: number }>();

    try {
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.countryCode !== countryCode || data.stateCode !== stateCode) return;
            const city = data.city;
            if (!city) return;

            const current = cityAggregations.get(city) || { views: 0, guestViews: 0, authViews: 0 };
            const count = data.count || 0;
            
            current.views += count;
            if (data.audienceType === 'guest') {
                current.guestViews += count;
            } else {
                current.authViews += count;
            }
            cityAggregations.set(city, current);
        });

        const results = Array.from(cityAggregations.entries()).map(([city, counts]) => ({
            city,
            ...counts
        }));
        
        return results.sort((a, b) => b.views - a.views).slice(0, 15);

    } catch (error) {
        console.error(`Error fetching top cities for ${countryCode}/${stateCode}:`, error);
        return [];
    }
};


export const getTopPostsByMetric = async (metric: 'likes' | 'commentsCount' | 'reposts' | 'views', limitCount: number = 5): Promise<Post[]> => {
    // Fetch a larger pool of recent public posts to sort from as a workaround for missing specific indexes
    const q = query(
        postsCollection,
        where("visibility", "==", "public"),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        firestoreLimit(100) // Fetch 100 recent posts as a sample
    );
    
    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) return [];

        const postPromises = snapshot.docs.map(doc => getPostById(doc.id, null));
        let posts = (await Promise.all(postPromises)).filter((p): p is Post => !!p);

        // Sort client-side
        posts.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));

        // Return the top N
        return posts.slice(0, limitCount);
    } catch (error) {
        console.error(`Error in getTopPostsByMetric for metric ${metric}:`, error);
        return []; // Return empty array on error
    }
};

export const getTopPostsByViewsAnalytics = async (range: AdminRange = '7d', limitCount: number = 5): Promise<TopPostViewData[]> => {
    const days = daysOfRange(range);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const q = query(
        collection(db, 'access_agg_daily'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );

    const postViewAggregations = new Map<string, { totalViews: number; guestViews: number; authViews: number; samplePath: string }>();

    try {
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const data = doc.data();
            const path = data.path || '/';
            
            const match = path.match(/\/post\/([a-zA-Z0-9_-]+)/);
            if (!match || !match[1]) return;
            
            const postId = match[1];
            const count = data.count || 0;
            const audienceType = data.audienceType || 'guest';

            const current = postViewAggregations.get(postId) || { totalViews: 0, guestViews: 0, authViews: 0, samplePath: path };
            
            current.totalViews += count;
            if (audienceType === 'guest') {
                current.guestViews += count;
            } else {
                current.authViews += count;
            }
            postViewAggregations.set(postId, current);
        });

        const results = Array.from(postViewAggregations.entries()).map(([postId, counts]) => ({
            postId,
            path: counts.samplePath,
            ...counts
        }));

        const topPosts = results.sort((a, b) => b.totalViews - a.totalViews).slice(0, limitCount);
        
        const hydratedTopPosts = await Promise.all(
            topPosts.map(async (postView) => {
                const postDetails = await getPostById(postView.postId);
                return {
                    ...postView,
                    postDetails,
                };
            })
        );
        
        return hydratedTopPosts.filter((p): p is TopPostViewData & { postDetails: Post } => !!p.postDetails);

    } catch (error) {
        console.error('Error fetching top posts by views analytics:', error);
        return [];
    }
};

export const getMostActiveUsers = async (metric: 'postsCount' | 'followersCount', limitCount: number = 5): Promise<User[]> => {
    // As a workaround for missing indexes, we fetch all users and sort them client-side.
    // This is not scalable for a large user base but works for a small to medium number of users.
    try {
        const allUsers = await getAllUsers();
        
        // Sort client-side
        allUsers.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
        
        return allUsers.slice(0, limitCount);
    } catch (error) {
        console.error(`Error in getMostActiveUsers for metric ${metric}:`, error);
        return []; // Return empty array on error
    }
};

const createdAtMs = (value: unknown): number => {
    if (!value) return 0;
    if (typeof value === 'string' || typeof value === 'number') {
        const ms = new Date(value).getTime();
        return Number.isNaN(ms) ? 0 : ms;
    }
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
        return (value as { toDate: () => Date }).toDate().getTime();
    }
    return 0;
};

export const getRecentLocalUsers = async (limitCount: number = 15): Promise<{ users: User[]; totalLocalUsers: number }> => {
    try {
        const allUsers = await getAllUsers();
        const localUsers = allUsers.filter((u) => {
            const isRemote = Boolean((u as User & { isRemoteFediverse?: boolean }).isRemoteFediverse) || u.id.startsWith('ap_');
            return !isRemote && u.id !== 'adminUserSoberan';
        });
        localUsers.sort((a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt));
        return {
            users: localUsers.slice(0, limitCount),
            totalLocalUsers: localUsers.length,
        };
    } catch (error) {
        console.error('Error in getRecentLocalUsers:', error);
        return { users: [], totalLocalUsers: 0 };
    }
};

      
