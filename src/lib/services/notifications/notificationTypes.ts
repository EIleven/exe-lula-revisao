// src/lib/services/notifications/notificationTypes.ts
import type { Timestamp } from 'firebase/firestore';
import type { NotificationActor } from '@/lib/types';

export type NotificationFilter = 'all' | 'replies' | 'mentions' | 'followers' | 'articles';

export type NotificationType =
  | 'like_post'
  | 'like_repost'
  | 'repost'
  | 'repost_repost'
  | 'quote'
  | 'comment_on_post'
  | 'reply_to_comment'
  | 'new_follower'
  | 'follow_back'
  | 'like_comment'
  | 'mention_in_post'
  | 'mention_in_comment'
  | 'new_post_from_user'
  | 'new_message'
  | 'new_conversation'
  | 'welcome';

export interface Notification {
  id: string;
  recipientId: string;
  type: NotificationType;
  actors: NotificationActor[];
  count: number;
  entityId?: string;
  entityParentId?: string;
  entityType?: 'post' | 'comment' | 'user' | 'conversation';
  previewText?: string | null;
  newPostId?: string;
  createdAt: string | Timestamp;
  readAt?: string | Timestamp | null;
}
