// src/components/explore/ExploreView.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { MapPin, Plus, Search, Settings } from 'lucide-react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

import TrendingFeeds from './TrendingFeeds';
import SuggestedAccounts from './SuggestedAccounts';
import SuggestedPosts from './SuggestedPosts';
import { ExploreSettingsDialog } from './ExploreSettingsDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  BRAZIL_COMMUNITY_TYPES,
  DEFAULT_EXPLORE_PREFERENCES,
  formatExploreLocationLabel,
  type ExplorePreferences,
} from '@/lib/constants/brazilLocations';

type ExploreTab = 'forYou' | 'trending' | 'communities' | 'news' | 'sports' | 'culture';

const EXPLORE_TABS: { id: ExploreTab; label: string }[] = [
  { id: 'forYou', label: 'Explorar' },
  { id: 'trending', label: 'Assuntos do Momento' },
  { id: 'communities', label: 'Comunidades' },
  { id: 'news', label: 'Notícias' },
  { id: 'sports', label: 'Esportes' },
  { id: 'culture', label: 'Cultura' },
];

const STORAGE_KEY = 'echo_explore_prefs_v1';

export default function ExploreView() {
  const router = useRouter();
  const locale = useLocale();
  const currentUserId = useCurrentUserId();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<ExploreTab>('forYou');
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [communityFilterId, setCommunityFilterId] = useState<string>('all');
  const [preferences, setPreferences] = useState<ExplorePreferences>(DEFAULT_EXPLORE_PREFERENCES);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ExplorePreferences>;
        setPreferences({ ...DEFAULT_EXPLORE_PREFERENCES, ...parsed });
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    getDoc(doc(db, 'users', currentUserId))
      .then((snap) => {
        if (!active || !snap.exists()) return;
        const remote = snap.data()?.explorePreferences as Partial<ExplorePreferences> | undefined;
        if (remote) {
          const merged = { ...DEFAULT_EXPLORE_PREFERENCES, ...remote };
          setPreferences(merged);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // ignore offline/read error
      });
    return () => {
      active = false;
    };
  }, [currentUserId]);

  const handleSavePreferences = async (next: ExplorePreferences) => {
    setPreferences(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (currentUserId) {
      try {
        await updateDoc(doc(db, 'users', currentUserId), {
          explorePreferences: next,
        });
      } catch {
        // local state is already updated
      }
    }
    toast({
      title: 'Localização atualizada',
      description: `Exibindo tendências e conteúdos para ${formatExploreLocationLabel(next)}.`,
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    router.push(`/${locale}/search?q=${encodeURIComponent(q)}`);
  };

  const locationLabel = formatExploreLocationLabel(preferences);
  const communityPills = useMemo(() => {
    const hidden = new Set(preferences.hiddenCommunityIds ?? []);
    const defaults = BRAZIL_COMMUNITY_TYPES
      .filter((ct) => ct.id !== 'outro' && !hidden.has(ct.id))
      .map((ct) => ({
        id: ct.id,
        label: ct.label.split(' / ')[0],
        keywords: ct.keywords,
        isCustom: false,
      }));
    const custom = (preferences.pinnedTopics ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      keywords: t.query
        .split(/[,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      isCustom: true,
    }));
    return [...defaults, ...custom];
  }, [preferences.hiddenCommunityIds, preferences.pinnedTopics]);

  const activeCommunityTopic = useMemo(() => {
    return communityPills.find((p) => p.id === communityFilterId) ?? communityPills[0];
  }, [communityPills, communityFilterId]);

  useEffect(() => {
    if (!communityPills.some((p) => p.id === communityFilterId)) {
      setCommunityFilterId('all');
    }
  }, [communityPills, communityFilterId]);

  const hasCustomLocation =
    (preferences.pinnedTopics?.length ?? 0) > 0 ||
    (preferences.hiddenCommunityIds?.length ?? 0) > 0 ||
    (preferences.useLocalLocation &&
      (preferences.stateCode !== 'BR' ||
        Boolean(preferences.city.trim()) ||
        preferences.communityType !== 'all' ||
        Boolean(preferences.communityName.trim())));

  return (
    <div className="min-w-0">
      <ExploreSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        preferences={preferences}
        onSave={handleSavePreferences}
      />

      {/* Sticky X-style Search + Settings + Tabs */}
      <div className="sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="flex items-center gap-2 px-3 sm:px-4 pt-2.5 pb-2">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar no Exe. Lula"
              className="h-9 sm:h-10 rounded-full border-border/70 bg-muted/35 pl-10 pr-4 text-sm focus-visible:ring-primary"
            />
          </form>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title="Configurações da aba Explorar (Brasil)"
            aria-label="Configurações da aba Explorar"
            className="relative h-9 w-9 shrink-0 rounded-full hover:bg-muted/60"
          >
            <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
            {hasCustomLocation && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
            )}
          </Button>
        </div>

        {/* Horizontal scrollable tabs */}
        <div
          role="tablist"
          aria-label="Abas do Explorar"
          className="flex items-center overflow-x-auto no-scrollbar px-2 sm:px-3"
        >
          {EXPLORE_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative shrink-0 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'font-bold text-foreground'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subtle active Brazil location pill */}
      {hasCustomLocation && (
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-primary/[0.04] px-4 py-2 text-xs">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex min-w-0 items-center gap-1.5 text-primary hover:underline"
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-medium">Foco Brasil: {locationLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            Alterar
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'forYou' && (
        <div className="divide-y divide-border/80">
          <TrendingFeeds
            locationLabel={locationLabel}
            limit={5}
            onShowMore={() => setActiveTab('trending')}
          />
          <SuggestedAccounts preferences={preferences} />
          <SuggestedPosts preferences={preferences} />
        </div>
      )}

      {activeTab === 'trending' && (
        <TrendingFeeds locationLabel={locationLabel} limit={20} />
      )}

      {activeTab === 'communities' && (
        <div className="divide-y divide-border/80">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-4 py-2.5">
            {communityPills.map((pill) => {
              const selected = activeCommunityTopic?.id === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setCommunityFilterId(pill.id)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap',
                    selected
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Adicionar ou remover temas fixados"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border/80 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary whitespace-nowrap"
            >
              <Plus className="h-3 w-3" />
              Temas
            </button>
          </div>
          <SuggestedPosts
            preferences={preferences}
            communityFilterId={activeCommunityTopic?.id ?? 'all'}
            activeTopic={
              activeCommunityTopic && activeCommunityTopic.id !== 'all'
                ? {
                    id: activeCommunityTopic.id,
                    label: activeCommunityTopic.label,
                    keywords: activeCommunityTopic.keywords,
                  }
                : undefined
            }
          />
        </div>
      )}

      {activeTab === 'news' && (
        <SuggestedPosts newsCategory="Notícias Locais" preferences={preferences} />
      )}

      {activeTab === 'sports' && (
        <SuggestedPosts newsCategory="Esportes" preferences={preferences} />
      )}

      {activeTab === 'culture' && (
        <SuggestedPosts newsCategory="Artes" preferences={preferences} />
      )}
    </div>
  );
}
