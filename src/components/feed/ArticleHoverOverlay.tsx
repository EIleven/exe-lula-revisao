'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ExternalLink, Globe, Hash, Loader2, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { getUser } from '@/lib/services/userService';
import { getHashtagStats } from '@/lib/services/hashtagService';
import type { User } from '@/lib/types';
import { compactCount } from '@/lib/media/videoQueue';
import { remoteMentionExternalUrl } from '@/lib/utils/textUtils';

type HoverTarget =
  | { kind: 'local'; uid?: string; handle: string }
  | { kind: 'remote'; user: string; domain: string }
  | { kind: 'tag'; tag: string };

interface ActiveHoverState {
  target: HoverTarget;
  rect: { left: number; top: number; bottom: number; width: number };
}

interface ArticleHoverOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  locale: string;
}

function parseHoverTarget(anchor: HTMLAnchorElement): HoverTarget | null {
  const remoteAcct = anchor.getAttribute('data-hv-remote-acct');
  if (remoteAcct) {
    const decoded = decodeURIComponent(remoteAcct);
    const atIndex = decoded.indexOf('@');
    if (atIndex > 0 && atIndex < decoded.length - 1) {
      return {
        kind: 'remote',
        user: decoded.slice(0, atIndex),
        domain: decoded.slice(atIndex + 1),
      };
    }
  }

  const localHandle = anchor.getAttribute('data-hv-local-handle');
  const localUid = anchor.getAttribute('data-hv-local-uid');
  if (localHandle || localUid) {
    return {
      kind: 'local',
      uid: localUid ? decodeURIComponent(localUid) : undefined,
      handle: localHandle ? decodeURIComponent(localHandle) : '',
    };
  }

  const tag = anchor.getAttribute('data-hv-tag');
  if (tag) {
    return {
      kind: 'tag',
      tag: decodeURIComponent(tag),
    };
  }

  return null;
}

function targetKey(target: HoverTarget): string {
  if (target.kind === 'local') return `local:${target.uid || target.handle}`;
  if (target.kind === 'remote') return `remote:${target.user}@${target.domain}`;
  return `tag:${target.tag.toLowerCase()}`;
}

export default function ArticleHoverOverlay({ containerRef, locale }: ArticleHoverOverlayProps) {
  const activeUserId = useCurrentUserId();
  const [hover, setHover] = useState<ActiveHoverState | null>(null);
  const [localUsers, setLocalUsers] = useState<Record<string, User | null>>({});
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const userCacheRef = useRef<Map<string, User | null>>(new Map());
  const tagCacheRef = useRef<Map<string, number>>(new Map());

  const clearTimers = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      activeAnchorRef.current = null;
      setHover(null);
    }, 180);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseOver = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const anchor = targetEl?.closest?.('a[data-hv-local-handle], a[data-hv-local-uid], a[data-hv-remote-acct], a[data-hv-tag]') as HTMLAnchorElement | null;
      if (!anchor || !container.contains(anchor)) return;

      const parsed = parseHoverTarget(anchor);
      if (!parsed) return;

      clearTimers();
      activeAnchorRef.current = anchor;

      openTimerRef.current = setTimeout(() => {
        const rect = anchor.getBoundingClientRect();
        setHover({
          target: parsed,
          rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
        });
      }, 160);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const anchor = targetEl?.closest?.('a[data-hv-local-handle], a[data-hv-local-uid], a[data-hv-remote-acct], a[data-hv-tag]') as HTMLAnchorElement | null;
      if (!anchor || anchor !== activeAnchorRef.current) return;

      const related = e.relatedTarget as Node | null;
      if (related && anchor.contains(related)) return;

      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      scheduleClose();
    };

    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);
    return () => {
      clearTimers();
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('mouseout', handleMouseOut);
    };
  }, [containerRef]);

  useEffect(() => {
    if (!hover) return;
    const { target } = hover;

    if (target.kind === 'local' && target.uid) {
      const uid = target.uid;
      if (userCacheRef.current.has(uid)) {
        const cached = userCacheRef.current.get(uid) ?? null;
        setLocalUsers((prev) => (prev[uid] === cached ? prev : { ...prev, [uid]: cached }));
        return;
      }
      const key = targetKey(target);
      setLoadingKey(key);
      getUser(uid, activeUserId)
        .then((u) => {
          const resolved = u ?? null;
          userCacheRef.current.set(uid, resolved);
          setLocalUsers((prev) => ({ ...prev, [uid]: resolved }));
        })
        .catch(() => {
          userCacheRef.current.set(uid, null);
          setLocalUsers((prev) => ({ ...prev, [uid]: null }));
        })
        .finally(() => setLoadingKey((cur) => (cur === key ? null : cur)));
    } else if (target.kind === 'tag') {
      const normalized = target.tag.toLowerCase();
      if (tagCacheRef.current.has(normalized)) {
        const cached = tagCacheRef.current.get(normalized) ?? 0;
        setTagCounts((prev) => (prev[normalized] === cached ? prev : { ...prev, [normalized]: cached }));
        return;
      }
      const key = targetKey(target);
      setLoadingKey(key);
      getHashtagStats(`#${target.tag}`)
        .then((res) => {
          const count = res?.postCount ?? 0;
          tagCacheRef.current.set(normalized, count);
          setTagCounts((prev) => ({ ...prev, [normalized]: count }));
        })
        .catch(() => {
          tagCacheRef.current.set(normalized, 0);
          setTagCounts((prev) => ({ ...prev, [normalized]: 0 }));
        })
        .finally(() => setLoadingKey((cur) => (cur === key ? null : cur)));
    }
  }, [hover, activeUserId]);

  if (!hover || typeof document === 'undefined') return null;

  const cardWidth = 310;
  const margin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const centerX = hover.rect.left + hover.rect.width / 2;
  const left = Math.max(margin, Math.min(centerX - cardWidth / 2, viewportWidth - cardWidth - margin));
  const showBelow = hover.rect.bottom + 180 < viewportHeight || hover.rect.top < 170;
  const top = showBelow ? hover.rect.bottom + 8 : Math.max(margin, hover.rect.top - 8);

  const key = targetKey(hover.target);
  const isLoading = loadingKey === key;

  return createPortal(
    <div
      role="dialog"
      aria-label="Informações do link"
      onMouseEnter={() => {
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
      }}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        transform: showBelow ? undefined : 'translateY(-100%)',
        width: `${cardWidth}px`,
        zIndex: 60,
      }}
      className="rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-150"
    >
      {hover.target.kind === 'remote' && (
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Globe className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">@{hover.target.user}</p>
                <p className="truncate text-xs text-muted-foreground">{hover.target.domain}</p>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0 text-[10px] font-medium">
              Fediverso
            </Badge>
          </div>
          <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Perfil em instância externa. Respeitamos a autonomia da rede de origem, sem coleta automática de dados.
            </span>
          </p>
          <Button asChild size="sm" className="w-full h-8 text-xs font-medium">
            <a
              href={remoteMentionExternalUrl(hover.target.user, hover.target.domain)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Abrir em {hover.target.domain}</span>
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      )}

      {hover.target.kind === 'local' && (() => {
        const uid = hover.target.uid;
        const userObj = uid ? localUsers[uid] : null;
        if (isLoading && !userObj) {
          return (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Carregando perfil local…</span>
            </div>
          );
        }
        if (!uid || !userObj) {
          return (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">@{hover.target.handle}</p>
                  <p className="text-xs text-muted-foreground">HiperVerso · Rede local</p>
                </div>
              </div>
              <Button asChild size="sm" variant="secondary" className="w-full h-8 text-xs">
                <Link href={`/${locale}/search?q=${encodeURIComponent(`@${hover.target.handle}`)}`}>
                  Buscar @{hover.target.handle}
                </Link>
              </Button>
            </div>
          );
        }

        const profileUrl = `/${locale}/profile/${encodeURIComponent(userObj.id)}`;
        return (
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <Link href={profileUrl} className="flex items-center gap-2.5 min-w-0 group">
                <Avatar className="h-10 w-10 shrink-0 border border-border">
                  <AvatarImage src={userObj.avatarUrl || undefined} alt={userObj.name} />
                  <AvatarFallback>{(userObj.name || userObj.username || '?')[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold group-hover:underline">{userObj.name}</p>
                  <p className="truncate text-xs text-muted-foreground">@{userObj.username}@hiperverso.social</p>
                </div>
              </Link>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                Local
              </Badge>
            </div>
            {userObj.bio && (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{userObj.bio}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">{compactCount(userObj.followingCount || 0)}</strong> seguindo
              </span>
              <span>
                <strong className="text-foreground">{compactCount(userObj.followersCount || 0)}</strong> seguidores
              </span>
            </div>
            <Button asChild size="sm" className="w-full h-8 text-xs font-medium">
              <Link href={profileUrl}>Ver perfil no HiperVerso</Link>
            </Button>
          </div>
        );
      })()}

      {hover.target.kind === 'tag' && (() => {
        const normalized = hover.target.tag.toLowerCase();
        const count = tagCounts[normalized];
        const tagUrl = `/${locale}/tag/${encodeURIComponent(hover.target.tag)}`;
        return (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Hash className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">#{hover.target.tag}</p>
                <p className="text-xs text-muted-foreground">
                  {isLoading && count === undefined ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Contando publicações…
                    </span>
                  ) : (
                    `${count ?? 0} ${(count ?? 0) === 1 ? 'publicação' : 'publicações'} no HiperVerso`
                  )}
                </p>
              </div>
            </div>
            <Button asChild size="sm" variant="secondary" className="w-full h-8 text-xs font-medium">
              <Link href={tagUrl}>Explorar #{hover.target.tag}</Link>
            </Button>
          </div>
        );
      })()}
    </div>,
    document.body,
  );
}
