// src/components/profile/RelatedProfilesStrip.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { RecommendationPreferences, User } from '@/lib/types';
import { getRelatedProfiles, updateUserSettings } from '@/lib/services/userService';
import {
  persistLocalRecommendationPreferences,
  readRecommendationPreferences,
  REC_PREFS_EVENT,
} from '@/lib/recommendations/preferences';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import RemoteFollowButton, { isRemoteFediverseUser } from './RemoteFollowButton';
import RecommendationSettingsDialog from '@/components/recommendations/RecommendationSettingsDialog';
import { FOLLOW_STATE_EVENT, type FollowStateEventDetail } from '@/lib/events/followState';
import { useFollowToggle } from '@/hooks/features/profile/useFollowToggle';
import { useToast } from '@/hooks/use-toast';

interface RelatedProfilesStripProps {
  profileUser: User;
}

function formatReasonLabel(user: User): string | null {
  const r = user.recommendationReason;
  if (!r) return null;
  if (r.kind === 'related-profile' && r.label) return r.label;
  if (r.kind === 'follows-you') return 'Segue você';
  if (r.kind === 'mutual') return `${r.count} em comum`;
  if (r.kind === 'interest') return `#${r.topic}`;
  if (r.kind === 'active') return 'Ativo agora';
  return null;
}

const RelatedProfileMiniCard: React.FC<{
  candidate: User;
  activeUserId: string;
  locale: string;
  onFollowed: (id: string) => void;
}> = ({ candidate, activeUserId, locale, onFollowed }) => {
  const { toast } = useToast();
  const follow = useFollowToggle({
    targetUserId: candidate.id,
    activeUserId,
    isFollowing: candidate.isFollowing,
    followersCount: candidate.followersCount,
    onFailure: () => {
      toast({ title: 'Não foi possível seguir agora', variant: 'destructive' });
    },
    onSettled: (view) => {
      if (view.isFollowing) {
        onFollowed(candidate.id);
      }
    },
  });

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    follow.toggle();
  };

  const reasonLabel = formatReasonLabel(candidate);
  const isRemote = isRemoteFediverseUser(candidate);

  return (
    <div className="flex flex-col justify-between gap-2 rounded-xl border border-border/70 bg-card/50 p-2.5 min-w-[168px] max-w-[190px] shrink-0 transition-colors hover:border-primary/40">
      <Link
        href={`/${locale}/profile/${candidate.id}`}
        className="flex items-center gap-2 min-w-0 group"
        data-interactive="true"
      >
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={candidate.avatarUrl} alt={candidate.name} />
          <AvatarFallback>{candidate.name?.[0] || '?'}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground truncate group-hover:underline">
            {candidate.name}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            @{candidate.username}
          </p>
        </div>
      </Link>

      <div className="flex items-center justify-between gap-1.5 pt-0.5">
        {reasonLabel ? (
          <span className="text-[10px] text-muted-foreground truncate max-w-[85px]" title={reasonLabel}>
            {reasonLabel}
          </span>
        ) : (
          <span />
        )}
        {isRemote ? (
          <RemoteFollowButton
            targetUser={candidate}
            activeUserId={activeUserId}
            compact
            onStateChange={(next: User) => {
              if (next.isFollowing) onFollowed(candidate.id);
            }}
          />
        ) : (
          <Button
            type="button"
            size="sm"
            variant={follow.isFollowing ? 'outline' : 'default'}
            onClick={handleToggle}
            className="h-7 px-2.5 text-xs rounded-full shrink-0"
          >
            {follow.isFollowing ? 'Seguindo' : 'Seguir'}
          </Button>
        )}
      </div>
    </div>
  );
};

export default function RelatedProfilesStrip({ profileUser }: RelatedProfilesStripProps) {
  const locale = useLocale();
  const { currentUser, refreshCurrentUser } = useCurrentUser();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<RecommendationPreferences>(() =>
    readRecommendationPreferences(currentUser),
  );
  const [related, setRelated] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setPrefs(readRecommendationPreferences(currentUser));
  }, [currentUser]);

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<RecommendationPreferences>).detail;
      if (detail) setPrefs(detail);
    };
    window.addEventListener(REC_PREFS_EVENT, onPrefsChanged);
    return () => window.removeEventListener(REC_PREFS_EVENT, onPrefsChanged);
  }, []);

  const loadRelated = useCallback(async () => {
    if (!currentUser?.id || !prefs.enabled || !prefs.showOnProfiles) {
      setRelated([]);
      return;
    }
    setIsLoading(true);
    try {
      const users = await getRelatedProfiles(profileUser, currentUser.id, 6, prefs);
      setRelated(users);
    } catch {
      setRelated([]);
    } finally {
      setIsLoading(false);
    }
  }, [profileUser, currentUser?.id, prefs]);

  useEffect(() => {
    void loadRelated();
  }, [loadRelated]);

  useEffect(() => {
    const syncFollowState = (event: Event) => {
      const detail = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (detail.activeUserId !== currentUser?.id || !detail.isFollowing) return;
      setRelated((prev) => prev.filter((u) => u.id !== detail.targetUserId));
    };
    window.addEventListener(FOLLOW_STATE_EVENT, syncFollowState);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, syncFollowState);
  }, [currentUser?.id]);

  const handleHideFromProfiles = async () => {
    const next: RecommendationPreferences = { ...prefs, showOnProfiles: false };
    setPrefs(next);
    setRelated([]);
    persistLocalRecommendationPreferences(next);
    if (currentUser?.id) {
      try {
        await updateUserSettings(currentUser.id, { recommendationPreferences: next });
        await refreshCurrentUser();
      } catch {
        // local cache already updated
      }
    }
    toast({
      title: 'Relacionados ocultos nos perfis',
      description: 'Você pode reativar quando quiser em Configurações > Privacidade.',
    });
  };

  if (!currentUser?.id || !prefs.enabled || !prefs.showOnProfiles) {
    return (
      <RecommendationSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    );
  }

  if (!isLoading && related.length === 0) {
    return (
      <RecommendationSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    );
  }

  return (
    <div className="px-4 py-3 border-b border-border/70 bg-muted/15">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Perfis relacionados</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => setSettingsOpen(true)}
            title="Configurar algoritmo de sugestões"
            aria-label="Configurar algoritmo de sugestões"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleHideFromProfiles}
            title="Ocultar relacionados nos perfis"
            aria-label="Ocultar relacionados nos perfis"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex gap-2.5 overflow-x-auto no-scrollbar">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-[88px] min-w-[168px] rounded-xl border border-border/50 bg-muted/30 animate-pulse shrink-0" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
          {related.map((candidate) => (
            <RelatedProfileMiniCard
              key={candidate.id}
              candidate={candidate}
              activeUserId={currentUser.id}
              locale={locale}
              onFollowed={(id) => setRelated((prev) => prev.filter((u) => u.id !== id))}
            />
          ))}
        </div>
      )}

      <RecommendationSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
