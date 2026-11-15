// src/lib/services/notifications/notificationUtils.ts
import { Timestamp } from 'firebase/firestore';
import { Notification } from './notificationTypes';

/**
 * Creates a deep copy of a notification object, ensuring no references are shared.
 * This is useful for preventing accidental mutations of state.
 * @param notification The notification object to copy.
 * @returns A deep copy of the notification object.
 */
export const deepCopyNotification = (
  notification: Notification | null
): Notification | null => {
  if (!notification) return null;
  return JSON.parse(JSON.stringify(notification));
};

/**
 * A utility function to check if a notification was successfully sent.
 * Logs a warning to the console if the notification object is null or undefined.
 *
 * @param notification The notification object returned from a creation function.
 * @param context A string describing the context of the notification (e.g., "like notification").
 */
export const ensureNotificationSent = (
  notification: Notification | null | undefined,
  context: string
): void => {
  if (!notification) {
    console.warn(`[Notification Service] Failed to send ${context}.`);
  }
};

/**
 * Transforms Firestore Timestamps in a notification object to ISO strings.
 *
 * @param data The notification data from Firestore.
 * @param id The document ID.
 * @returns A notification object with ISO date strings.
 */
export const transformNotificationTimestamps = (
  data: any,
  id: string
): Notification => {
  return {
    ...data,
    id,
    createdAt: (data.createdAt as Timestamp).toDate().toISOString(),
    readAt: data.readAt
      ? (data.readAt as Timestamp).toDate().toISOString()
      : null,
  } as Notification;
};
