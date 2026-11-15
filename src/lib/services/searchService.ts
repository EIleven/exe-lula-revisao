// src/lib/services/searchService.ts
import type { User, Post, Comment } from '@/lib/types';
import { searchUsers } from './userService';
import { getTopHashtags } from './hashtagService';
import { searchPosts, searchComments, getComparableTime } from './postReadService';

export interface SearchResult {
  users: User[];
  hashtags: string[];
}

export interface SearchResultWithCounts {
  top: (Post | Comment)[];
  latest: (Post | Comment)[];
  people: User[];
  feeds: { tag: string; count: number }[];
  articles: Post[];
  counts: {
    top: number;
    latest: number;
    people: number;
    feeds: number;
    articles: number;
  };
}

/**
 * Performs a global search for users and hashtags for the search popover.
 * @param query The search query string.
 * @param activeUserId The ID of the currently logged-in user.
 * @returns A promise that resolves to a SearchResult object.
 */
export const performGlobalSearch = async (
  query: string,
  activeUserId: string | null = null
): Promise<SearchResult> => {
  if (query.length < 2) {
    return { users: [], hashtags: [] };
  }

  const lowerCaseQuery = query.toLowerCase();

  try {
    // Search for users
    const userPromise = searchUsers(query, activeUserId);

    // Search for hashtags
    const hashtagPromise = getTopHashtags(50).then(allHashtags =>
      allHashtags
        .filter(ht => ht.tag.toLowerCase().includes(lowerCaseQuery))
        .map(ht => ht.tag)
        .slice(0, 5) // Limit to 5 matching hashtags
    );

    const [users, hashtags] = await Promise.all([userPromise, hashtagPromise]);

    return { users, hashtags };
  } catch (error) {
    console.error("Error in performGlobalSearch:", error);
    return { users: [], hashtags: [] }; // Return empty on error
  }
};

/**
 * Performs a comprehensive search across all categories and returns results and counts.
 * @param query The search query string.
 * @param activeUserId The ID of the currently logged-in user.
 * @returns A promise that resolves to a SearchResultWithCounts object.
 */
export const getSearchResultsWithCounts = async (
  query: string,
  activeUserId: string | null = null
): Promise<Partial<SearchResultWithCounts>> => {
  if (!query.trim()) return {};

  try {
    const [
        searchedPosts, 
        searchedComments, 
        people, 
        feeds
    ] = await Promise.all([
      searchPosts(query, activeUserId, 'latest'), // using 'latest' to get a base set of posts.
      searchComments(query, activeUserId),
      searchUsers(query, activeUserId),
      getTopHashtags(100).then(allHashtags =>
        allHashtags.filter(ht =>
          ht.tag.toLowerCase().includes(query.toLowerCase().replace('#', ''))
        )
      ),
    ]);

    const allContent: (Post|Comment)[] = [...searchedPosts, ...searchedComments];

    // De-duplicate content. A post and a comment could have same ID if something is wrong.
    const uniqueContent = Array.from(new Map(allContent.map(item => [item.id, item])).values());
    
    // Sort for 'Top' tab (by likes)
    const topContent = [...uniqueContent].sort((a, b) => (b.likes || 0) - (a.likes || 0));
    // Sort for 'Latest' tab (by creation date)
    const latestContent = [...uniqueContent].sort((a, b) => getComparableTime(b.createdAt) - getComparableTime(a.createdAt));
    
    // Filter for 'Articles' tab
    const articles = searchedPosts.filter(p => p.category === 'news');

    return {
      top: topContent,
      latest: latestContent,
      people: people,
      feeds: feeds,
      articles: articles,
      counts: {
        top: topContent.length,
        latest: latestContent.length,
        people: people.length,
        feeds: feeds.length,
        articles: articles.length,
      },
    };
  } catch (error) {
    console.error("Error getting search results with counts:", error);
    throw new Error("Failed to retrieve search results.");
  }
};
