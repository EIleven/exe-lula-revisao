
import type { User, Post, Comment, OriginalPostDetails, EmbeddedUserDetails, DirectMessage, Conversation, Notification } from '@/lib/types';

const createEmbeddedUserDetailsFromUser = (user: User): EmbeddedUserDetails => ({
    userId: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    "data-ai-hint": user["data-ai-hint"] || null,
});

export function deepCopyUser(userToCopy?: User): User | undefined {
    if (!userToCopy) return undefined;
    return { ...userToCopy };
}

export function deepCopyOriginalPostDetails(details?: OriginalPostDetails): OriginalPostDetails | undefined {
    if (!details) return undefined;
    let authorDetailsToUse = details.authorDetails;
    if (!authorDetailsToUse && (details as any).user) {
        console.warn("deepCopyOriginalPostDetails: details object is missing authorDetails, attempting to create from legacy user field.");
        authorDetailsToUse = createEmbeddedUserDetailsFromUser((details as any).user as User);
    }
    return {
        ...details,
        authorDetails: authorDetailsToUse ? { ...authorDetailsToUse } : undefined as unknown as EmbeddedUserDetails, 
    };
}

export function deepCopyDirectMessage(messageToCopy?: DirectMessage): DirectMessage | undefined {
    if (!messageToCopy) return undefined;
    return {
        ...messageToCopy,
        sender: messageToCopy.sender ? deepCopyUser(messageToCopy.sender) : undefined,
        senderDetails: messageToCopy.senderDetails ? { ...messageToCopy.senderDetails } : undefined,
    };
}

export function deepCopyConversation(conversationToCopy?: Conversation): Conversation | undefined {
    if (!conversationToCopy) return undefined;
    return {
        ...conversationToCopy,
        participantsInfo: Array.isArray(conversationToCopy.participantsInfo)
            ? conversationToCopy.participantsInfo.map(pInfo => deepCopyUser(pInfo)!) 
            : [],
        lastMessage: conversationToCopy.lastMessage 
            ? deepCopyDirectMessage(conversationToCopy.lastMessage) 
            : null, 
    };
}

export function deepCopyComment(commentToCopy?: Comment): Comment | undefined {
    if (!commentToCopy) return undefined;
    return {
        ...commentToCopy,
        user: commentToCopy.user ? deepCopyUser(commentToCopy.user) : undefined,
        authorDetails: commentToCopy.authorDetails ? { ...commentToCopy.authorDetails } : undefined as unknown as EmbeddedUserDetails,
        parentPostUser: commentToCopy.parentPostUser ? deepCopyUser(commentToCopy.parentPostUser) : undefined,
        parentPostAuthorDetails: commentToCopy.parentPostAuthorDetails ? { ...commentToCopy.parentPostAuthorDetails } : undefined,
    };
}

export function deepCopyPost(postToCopy?: Post): Post | undefined {
    if (!postToCopy) return undefined;
    return {
        ...postToCopy,
        user: deepCopyUser(postToCopy.user) as User, 
        authorDetails: postToCopy.authorDetails ? { ...postToCopy.authorDetails } : undefined,
        comments: Array.isArray(postToCopy.comments) 
            ? postToCopy.comments.map(c => deepCopyComment(c)).filter(Boolean) as Comment[] 
            : [],
        originalPostDetails: postToCopy.originalPostDetails 
            ? deepCopyOriginalPostDetails(postToCopy.originalPostDetails) 
            : undefined,
    };
}

export function deepCopyNotification(notificationToCopy?: Notification): Notification | undefined {
    if (!notificationToCopy) return undefined;
    return {
        ...notificationToCopy,
        actors: Array.isArray(notificationToCopy.actors) ? notificationToCopy.actors.map(a => ({...a})) : [],
    };
}

export const serializeTimestamps = (data: any): any => {
    if (data === null || typeof data !== 'object') {
      return data;
    }
  
    if (data instanceof Date) {
      return data.toISOString();
    }
  
    if (Array.isArray(data)) {
      return data.map(serializeTimestamps);
    }
  
    const newData: { [key: string]: any } = {};
    for (const key in data) {
      newData[key] = serializeTimestamps(data[key]);
    }
    return newData;
};
