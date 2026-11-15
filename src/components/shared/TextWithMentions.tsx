// src/components/shared/TextWithMentions.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo, Fragment } from 'react';
import type { User } from '@/lib/types';
import { useLocale } from 'next-intl';
import UserProfileHoverCard from '@/components/profile/UserProfileHoverCard';
import HashtagHoverCard from '@/components/hashtags/HashtagHoverCard';
import { lookupUsersByUsername } from '@/lib/services/mentionLookup';

interface TextWithMentionsProps {
  text?: string;
  linkClassName?: string;
  customEmojis?: Record<string, string> | null;
}

const TextWithMentions: React.FC<TextWithMentionsProps> = ({
  text,
  linkClassName = 'text-primary hover:underline',
  customEmojis,
}) => {
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const locale = useLocale();
  const [clientHasMounted, setClientHasMounted] = useState(false);

  useEffect(() => {
    setClientHasMounted(true);
  }, []);

  useEffect(() => {
    async function fetchMentionedUsers() {
      if (!text || !clientHasMounted) {
        setIsLoading(false);
        return;
      }
      
      const mentionRegex = /(@[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|@[a-zA-Z0-9_]+)/g;
      const matches = text.match(mentionRegex);
      if (!matches) {
        setIsLoading(false);
        setUsers(new Map());
        return;
      }

      const ownHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : 'exercitodolula.app';
      const uniqueUsernames = [
        ...new Set(
          matches
            .map((m) => {
              const fedi = m.match(/^@([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
              if (fedi) {
                return fedi[2].toLowerCase() === ownHost || fedi[2].toLowerCase() === 'exercitodolula.app'
                  ? fedi[1]
                  : null;
              }
              return m.substring(1);
            })
            .filter((u): u is string => Boolean(u)),
        ),
      ];
      if (uniqueUsernames.length === 0) {
        setIsLoading(false);
        setUsers(new Map());
        return;
      }

      setIsLoading(true);
      try {
        setUsers(await lookupUsersByUsername(uniqueUsernames));
      } catch (e) {
          console.error("Failed to fetch mentioned users:", e);
          setUsers(new Map());
      } finally {
          setIsLoading(false);
      }
    }

    fetchMentionedUsers();
  }, [text, clientHasMounted]);


  const processedText = useMemo(() => {
    if (!text) {
      return null;
    }

    if (isLoading) {
      return text.split(/(\r\n|\r|\n)/g).map((line, i) => (
        <Fragment key={`line-loading-${i}`}>
          {line.match(/(\r\n|\r|\n)/) ? <br /> : line}
        </Fragment>
      ));
    }

    const regex = /(https?:\/\/[^\s<>"'`)\]]+|@[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|@[a-zA-Z0-9_]+|#[a-zA-Z0-9_áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕçÇ]+|:[a-zA-Z0-9_]+:|\r\n|\r|\n)/g;
    const parts = text.split(regex);
    const ownHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : 'exercitodolula.app';

    return parts.map((part, index) => {
      if (!part) return null;

      if (part.startsWith('http://') || part.startsWith('https://')) {
        const trailingMatch = part.match(/([.,!?;:]+)$/);
        const trailing = trailingMatch ? trailingMatch[1] : '';
        const cleanUrl = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <Fragment key={`url-${index}`}>
            <a
              href={cleanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkClassName} break-all`}
              onClick={(e) => e.stopPropagation()}
              data-interactive="true"
            >
              {cleanUrl}
            </a>
            {trailing}
          </Fragment>
        );
      }

      const fediMatch = part.match(/^@([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
      if (fediMatch) {
        const [, fediUser, fediDomain] = fediMatch;
        const isLocalDomain = fediDomain.toLowerCase() === ownHost || fediDomain.toLowerCase() === 'exercitodolula.app';
        const localUser = isLocalDomain ? users.get(fediUser.toLowerCase()) : undefined;
        if (localUser) {
          return (
            <UserProfileHoverCard key={`mention-${localUser.id}-${index}`} user={localUser}>
              <Link
                href={`/${locale}/profile/${localUser.id}`}
                className={linkClassName}
                onClick={(e) => e.stopPropagation()}
                data-interactive="true"
              >
                {part}
              </Link>
            </UserProfileHoverCard>
          );
        }
        const remoteAcct = `${fediUser}@${fediDomain}`;
        const placeholderRemoteUser = {
          id: '',
          name: `@${fediUser}`,
          username: remoteAcct,
          email: '',
          bio: `Perfil no Fediverso (${fediDomain})`,
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          dmPreference: 'everyone',
          isAdmin: false,
          isModerator: false,
          profileVisibility: 'public',
          createdAt: '',
        } as User;
        return (
          <UserProfileHoverCard key={`fedi-mention-${index}`} user={placeholderRemoteUser} remoteHandle={remoteAcct}>
            <Link
              href={`/${locale}/fediverse/${encodeURIComponent(remoteAcct)}`}
              className={linkClassName}
              onClick={(e) => e.stopPropagation()}
              data-interactive="true"
            >
              {part}
            </Link>
          </UserProfileHoverCard>
        );
      }

      if (part.startsWith('@')) {
        const username = part.substring(1);
        const mentionedUser = users.get(username.toLowerCase());
        if (mentionedUser) {
          return (
            <UserProfileHoverCard key={`mention-${mentionedUser.id}-${index}`} user={mentionedUser}>
              <Link
                href={`/${locale}/profile/${mentionedUser.id}`}
                className={linkClassName}
                onClick={(e) => e.stopPropagation()}
                data-interactive="true"
              >
                {part}
              </Link>
            </UserProfileHoverCard>
          );
        }
      } else if (part.startsWith('#')) {
        const tagName = part.substring(1);
        if (tagName) {
          return (
            <HashtagHoverCard key={`tag-${tagName}-${index}`} tagName={part}>
              <Link
                href={`/${locale}/tag/${encodeURIComponent(tagName)}`}
                className={linkClassName}
                onClick={(e) => e.stopPropagation()}
                data-interactive="true"
              >
                {part}
              </Link>
            </HashtagHoverCard>
          );
        }
      } else if (part.startsWith(':') && part.endsWith(':') && customEmojis?.[part]) {
        return (
          <img
            key={`emoji-${index}`}
            src={customEmojis[part]}
            alt={part}
            title={part}
            loading="lazy"
            className="inline-block h-[1.15em] w-[1.15em] align-text-bottom mx-0.5 object-contain"
          />
        );
      } else if (part.match(/(\r\n|\r|\n)/)) {
        if (part === '\r\n' || part === '\n' || part === '\r') {
            return <br key={`br-${index}`} />;
        }
      }
      return <Fragment key={`text-${index}`}>{part}</Fragment>;
    });
  }, [text, users, isLoading, locale, customEmojis]);

  if (!text) return null;

  return <>{processedText}</>;
};

export default TextWithMentions;
