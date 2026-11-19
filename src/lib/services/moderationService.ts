// src/lib/services/moderationService.ts
import { auth, db } from '@/lib/firebase';
import type { Post, Comment, User } from '@/lib/types';
import {
  collection,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  getDocs,
  Timestamp,
  doc,
  updateDoc,
  onSnapshot,
} from 'firebase/firestore';
import { getPostById } from './postReadService';
import { getCommentById } from './comments';
import { getUser } from './userService';
import { deletePost } from './posts/interactPostActions';
import { deleteComment } from './comments/commentWriteActions';

export interface Report {
    id: string;
    reporterId: string;
    contentType: 'post' | 'comment';
    contentId: string; // postId or commentId
    postId?: string; // parent postId if contentType is comment
    reason: string;
    status: 'pending' | 'resolved';
    createdAt: string;
}

export interface ReportedItem {
    reportId: string;
    contentType: 'post' | 'comment';
    reportedContent: Post | Comment;
    reason: string;
    reporterInfo: User;
    reportCreatedAt: string;
}

/**
 * DEPRECATED: Fetches content that has been reported. Use subscribeToReportedContent for real-time updates.
 * @returns A promise that resolves to an array of reported items with their full content.
 */
export const getReportedContent = async (): Promise<ReportedItem[]> => {
    const reportsRef = collection(db, 'reports');
    const q = query(
        reportsRef, 
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc'),
        firestoreLimit(25)
    );

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            return [];
        }

        const reportPromises = snapshot.docs.map(async (docSnap): Promise<ReportedItem | null> => {
            const report = { id: docSnap.id, ...docSnap.data() } as Report;
            
            let content: Post | Comment | undefined;
            if (report.contentType === 'post' && report.contentId) {
                content = await getPostById(report.contentId);
            } else if (report.contentType === 'comment' && report.postId && report.contentId) {
                content = await getCommentById(report.postId, report.contentId);
            }
            
            const reporter = await getUser(report.reporterId);

            if (content && reporter) {
                return {
                    reportId: report.id,
                    contentType: report.contentType,
                    reportedContent: content,
                    reason: report.reason,
                    reporterInfo: reporter,
                    reportCreatedAt: (report.createdAt as unknown as Timestamp).toDate().toISOString(),
                };
            }
            return null;
        });

        const results = await Promise.all(reportPromises);
        return results.filter((item): item is ReportedItem => item !== null);

    } catch (error) {
        console.error("Error fetching reported content:", error);
        throw error;
    }
};

/**
 * Subscribes to pending reported content for real-time updates.
 * @param callback A function that receives the array of reported items.
 * @returns An unsubscribe function.
 */
export const subscribeToReportedContent = (
  callback: (items: ReportedItem[]) => void,
  onError: (error: Error) => void
): (() => void) => {
  const reportsRef = collection(db, 'reports');
  const q = query(
    reportsRef,
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
    firestoreLimit(50) // Limit the number of real-time docs for performance
  );

  const unsubscribe = onSnapshot(q, async (snapshot) => {
    const reportPromises = snapshot.docs.map(async (docSnap): Promise<ReportedItem | null> => {
      const report = { id: docSnap.id, ...docSnap.data() } as Report;
      
      let content: Post | Comment | undefined;
      try {
        if (report.contentType === 'post' && report.contentId) {
            content = await getPostById(report.contentId);
        } else if (report.contentType === 'comment' && report.postId && report.contentId) {
            content = await getCommentById(report.postId, report.contentId);
        }
        
        const reporter = await getUser(report.reporterId);

        if (content && reporter) {
            return {
                reportId: report.id,
                contentType: report.contentType,
                reportedContent: content,
                reason: report.reason,
                reporterInfo: reporter,
                reportCreatedAt: (report.createdAt as unknown as Timestamp).toDate().toISOString(),
            };
        }
        return null;
      } catch (innerError) {
          console.error(`Error processing report ${report.id}:`, innerError);
          // If a single reported item fails to load (e.g., deleted), we should still show others.
          return null;
      }
    });

    const results = await Promise.all(reportPromises);
    callback(results.filter((item): item is ReportedItem => item !== null));
  }, (error) => {
    console.error("Error subscribing to reported content:", error);
    onError(error);
  });

  return unsubscribe;
};


async function postModerationAction(payload: Record<string, unknown>): Promise<void> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
        throw new Error('Sessão expirada. Entre novamente para moderar.');
    }
    const res = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
        throw new Error(json?.error || 'Falha ao processar moderação.');
    }
}

/**
 * Marks a report as resolved (ignored) without taking action on the content.
 * @param reportId The ID of the report to ignore.
 */
export const ignoreReport = async (reportId: string): Promise<void> => {
    await postModerationAction({ action: 'ignore', reportId });
};

/**
 * Deletes/tombstones the reported content and marks the report as resolved.
 * @param item The ReportedItem object containing all necessary info.
 */
export const deleteReportedContent = async (item: ReportedItem): Promise<void> => {
    const { reportId, contentType, reportedContent } = item;
    await postModerationAction({
        action: 'remove',
        reportId,
        contentType,
        contentId: reportedContent.id,
        postId: contentType === 'comment' ? (reportedContent as Comment).parentPostId : undefined,
    });
};
