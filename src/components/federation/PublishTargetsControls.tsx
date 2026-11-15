// src/components/federation/PublishTargetsControls.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Share2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import FederationReachControl from '@/components/federation/FederationReachControl';
import type { FederationReach } from '@/lib/federation/reach';
import { getSocialConnections, publishPostToSocialNetworks } from '@/lib/social/client';
import type { SocialConnectionsStatus, SocialProvider } from '@/lib/social/types';
import type { Post } from '@/lib/types';

/**
 * Estado e ações compartilhados por todos os modais de publicação (Post, Citação de Post e Citação de Comentário)
 * para manter a preferência do usuário no Fediverso e no Bluesky (Atmosfera) sincronizada em qualquer fluxo.
 */
export function usePublishTargets() {
  const { currentUser, firebaseUser } = useCurrentUser();
  const { toast } = useToast();
  const locale = useLocale();
  const t = useTranslations('CreatePostDialog');

  const [socialStatus, setSocialStatus] = useState<SocialConnectionsStatus | null>(null);
  const [selectedNetworks, setSelectedNetworks] = useState<SocialProvider[]>([]);
  const [federationReach, setFederationReach] = useState<FederationReach>('local');
  const postWillBePublic = currentUser?.profileVisibility !== 'private';

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    getSocialConnections(firebaseUser)
      .then((nextStatus) => {
        if (!active) return;
        setSocialStatus(nextStatus);
        const connected = (['bluesky'] as SocialProvider[]).filter((provider) => nextStatus.providers[provider]?.connection.connected);
        let stored: Partial<Record<SocialProvider, boolean>> = {};
        try {
          stored = JSON.parse(localStorage.getItem(`social-crosspost:${firebaseUser.uid}`) ?? '{}');
        } catch {
          /* ignore invalid old preference */
        }
        setSelectedNetworks(connected.filter((provider) => stored[provider] !== false));
      })
      .catch(() => {
        if (active) setSocialStatus(null);
      });

    try {
      const savedReach = localStorage.getItem(`federation-reach:${firebaseUser.uid}`);
      if (savedReach === 'local' || savedReach === 'public' || savedReach === 'unlisted' || savedReach === 'followers') {
        setFederationReach(savedReach);
      }
    } catch {
      /* ignore storage error */
    }
    return () => {
      active = false;
    };
  }, [firebaseUser]);

  const connectedNetworks = (['bluesky'] as SocialProvider[]).filter((provider) => socialStatus?.providers[provider]?.connection.connected);

  const updateFederationReach = useCallback(
    (nextReach: FederationReach) => {
      setFederationReach(nextReach);
      if (firebaseUser) {
        try {
          localStorage.setItem(`federation-reach:${firebaseUser.uid}`, nextReach);
        } catch {
          /* ignore */
        }
      }
    },
    [firebaseUser],
  );

  const toggleNetwork = useCallback(
    (provider: SocialProvider, checked: boolean) => {
      const next = checked ? [...new Set([...selectedNetworks, provider])] : selectedNetworks.filter((entry) => entry !== provider);
      setSelectedNetworks(next);
      if (firebaseUser) {
        const preference = Object.fromEntries((['bluesky'] as SocialProvider[]).map((entry) => [entry, next.includes(entry)]));
        localStorage.setItem(`social-crosspost:${firebaseUser.uid}`, JSON.stringify(preference));
      }
    },
    [firebaseUser, selectedNetworks],
  );

  const publishExternally = useCallback(
    async (post: Post, providers: SocialProvider[]) => {
      if (!firebaseUser || post.visibility !== 'public' || providers.length === 0) return;
      try {
        const results = await publishPostToSocialNetworks(firebaseUser, post.id, providers, locale);
        const published = results.filter((result) => result.ok).map(() => 'Bluesky');
        const failed = results.filter((result) => !result.ok).map(() => 'Bluesky');
        if (published.length > 0) {
          toast({
            title: t('crossPostSuccessTitle'),
            description:
              failed.length > 0
                ? t('crossPostPartialDescription', { published: published.join(', '), failed: failed.join(', ') })
                : t('crossPostSuccessDescription', { providers: published.join(', ') }),
            variant: failed.length > 0 ? 'destructive' : 'default',
          });
        } else if (failed.length > 0) {
          toast({ title: t('crossPostErrorTitle'), description: t('crossPostErrorDescription', { providers: failed.join(', ') }), variant: 'destructive' });
        }
      } catch (socialError) {
        toast({
          title: t('crossPostErrorTitle'),
          description: socialError instanceof Error ? socialError.message : t('crossPostGenericError'),
          variant: 'destructive',
        });
      }
    },
    [firebaseUser, locale, t, toast],
  );

  return {
    federationReach,
    updateFederationReach,
    connectedNetworks,
    selectedNetworks,
    toggleNetwork,
    postWillBePublic,
    publishExternally,
  };
}

interface PublishTargetsControlsProps {
  federationReach: FederationReach;
  onFederationChange: (reach: FederationReach) => void;
  connectedNetworks: SocialProvider[];
  selectedNetworks: SocialProvider[];
  onToggleNetwork: (provider: SocialProvider, checked: boolean) => void;
  postWillBePublic: boolean;
  disabled?: boolean;
}

export default function PublishTargetsControls({
  federationReach,
  onFederationChange,
  connectedNetworks,
  selectedNetworks,
  onToggleNetwork,
  postWillBePublic,
  disabled,
}: PublishTargetsControlsProps) {
  const locale = useLocale();
  const t = useTranslations('CreatePostDialog');
  const isMobile = useIsMobile();

  return (
    <>
      <FederationReachControl value={federationReach} onChange={onFederationChange} disabled={disabled} />
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-9 gap-1 rounded-full px-2.5" aria-label={t('crossPostMenuLabel')}>
            <Share2 className="h-4 w-4" />
            {!isMobile && (
              <span className="max-w-28 truncate text-xs">
                {selectedNetworks.length > 0 ? t('crossPostSelected', { count: selectedNetworks.length }) : t('crossPostMenuShort')}
              </span>
            )}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div>
            <p className="font-medium">{t('crossPostMenuTitle')}</p>
            <p className="text-xs text-muted-foreground">{postWillBePublic ? t('crossPostMenuDescription') : t('crossPostPrivateWarning')}</p>
          </div>
          {connectedNetworks.length > 0 ? (
            connectedNetworks.map((provider) => (
              <div key={provider} className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor={`cross-post-${provider}`} className="cursor-pointer">
                  Bluesky (Atmosfera)
                </Label>
                <Checkbox
                  id={`cross-post-${provider}`}
                  checked={postWillBePublic && selectedNetworks.includes(provider)}
                  disabled={!postWillBePublic || disabled}
                  onCheckedChange={(checked) => onToggleNetwork(provider, checked === true)}
                />
              </div>
            ))
          ) : (
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href={`/${locale}/settings/connections`}>{t('crossPostConnect')}</Link>
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

