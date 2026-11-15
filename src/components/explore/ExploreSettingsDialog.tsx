'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BRAZIL_COMMUNITY_TYPES,
  BRAZIL_STATES,
  DEFAULT_EXPLORE_PREFERENCES,
  type ExplorePreferences,
  type PinnedExploreTopic,
} from '@/lib/constants/brazilLocations';
import { MapPin, Loader2, Plus, RotateCcw, Tag, X } from 'lucide-react';

interface ExploreSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: ExplorePreferences;
  onSave: (next: ExplorePreferences) => Promise<void> | void;
}

export function ExploreSettingsDialog({
  open,
  onOpenChange,
  preferences,
  onSave,
}: ExploreSettingsDialogProps) {
  const [draft, setDraft] = useState<ExplorePreferences>(preferences);
  const [newTopicInput, setNewTopicInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft({
        ...DEFAULT_EXPLORE_PREFERENCES,
        ...preferences,
        pinnedTopics: preferences.pinnedTopics ?? [],
        hiddenCommunityIds: preferences.hiddenCommunityIds ?? [],
      });
      setNewTopicInput('');
    }
  }, [open, preferences]);

  const hiddenIds = draft.hiddenCommunityIds ?? [];
  const pinnedTopics = draft.pinnedTopics ?? [];
  const visibleDefaultCommunities = BRAZIL_COMMUNITY_TYPES.filter(
    (c) => c.id !== 'all' && c.id !== 'outro' && !hiddenIds.includes(c.id)
  );

  const handleAddTopic = () => {
    const raw = newTopicInput.trim();
    if (!raw) return;
    const cleanLabel = raw.slice(0, 36);
    const normalizedQuery = raw.replace(/^#/, '').trim().toLowerCase();
    if (!normalizedQuery) return;
    const alreadyExists = pinnedTopics.some(
      (t) => t.label.toLowerCase() === cleanLabel.toLowerCase() || t.query.toLowerCase() === normalizedQuery
    );
    if (alreadyExists) {
      setNewTopicInput('');
      return;
    }
    const nextTopic: PinnedExploreTopic = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: cleanLabel,
      query: raw.startsWith('#') ? raw : normalizedQuery,
    };
    setDraft((prev) => ({
      ...prev,
      pinnedTopics: [...(prev.pinnedTopics ?? []), nextTopic],
    }));
    setNewTopicInput('');
  };

  const handleRemoveDefaultCommunity = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      hiddenCommunityIds: Array.from(new Set([...(prev.hiddenCommunityIds ?? []), id])),
    }));
  };

  const handleRemoveCustomTopic = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      pinnedTopics: (prev.pinnedTopics ?? []).filter((t) => t.id !== id),
    }));
  };

  const handleRestoreDefaults = () => {
    setDraft((prev) => ({
      ...prev,
      hiddenCommunityIds: [],
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        ...draft,
        city: draft.city.trim(),
        communityName: draft.communityName.trim(),
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(DEFAULT_EXPLORE_PREFERENCES);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1.25rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background p-4 sm:p-6">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-bold">
            <MapPin className="h-5 w-5 shrink-0 text-primary" />
            <span>Configurações da aba Explorar</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configurações de localização da aba Explorar
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden pr-1 py-1">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-card/30 p-3.5">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="explore-local-toggle" className="text-sm font-semibold text-foreground">
                Mostrar conteúdo deste local
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Quando esta função está ativada, priorizamos assuntos e vozes da sua região ou comunidade no Brasil.
              </p>
            </div>
            <Switch
              id="explore-local-toggle"
              checked={draft.useLocalLocation}
              onCheckedChange={(checked) =>
                setDraft((prev) => ({ ...prev, useLocalLocation: checked }))
              }
            />
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="explore-state" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Estado (Brasil)
              </Label>
              <Select
                value={draft.stateCode}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, stateCode: value }))}
              >
                <SelectTrigger id="explore-state" className="w-full rounded-xl border-border bg-muted/20">
                  <SelectValue placeholder="Selecione um estado" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {BRAZIL_STATES.map((st) => (
                    <SelectItem key={st.code} value={st.code}>
                      {st.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="explore-city" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cidade / Município (opcional)
              </Label>
              <Input
                id="explore-city"
                value={draft.city}
                maxLength={60}
                onChange={(e) => setDraft((prev) => ({ ...prev, city: e.target.value }))}
                placeholder="Ex: Belo Horizonte, São Luís, Salvador..."
                className="rounded-xl border-border bg-muted/20"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="explore-community-type" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comunidade / Território (opcional)
              </Label>
              <Select
                value={draft.communityType}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, communityType: value }))}
              >
                <SelectTrigger id="explore-community-type" className="w-full rounded-xl border-border bg-muted/20">
                  <SelectValue placeholder="Todas as comunidades" />
                </SelectTrigger>
                <SelectContent>
                  {BRAZIL_COMMUNITY_TYPES.map((ct) => (
                    <SelectItem key={ct.id} value={ct.id}>
                      {ct.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="explore-community-name" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Nome da comunidade, aldeia, quilombo ou ocupação
              </Label>
              <Input
                id="explore-community-name"
                value={draft.communityName}
                maxLength={80}
                onChange={(e) => setDraft((prev) => ({ ...prev, communityName: e.target.value }))}
                placeholder="Ex: Ocupação Izidora, Quilombo Kalunga, Aldeia..."
                className="rounded-xl border-border bg-muted/20"
              />
            </div>

            <div className="space-y-2.5 rounded-xl border border-border/70 bg-card/30 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="explore-add-topic" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  <span>Temas e #hashtags fixados</span>
                </Label>
                {hiddenIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRestoreDefaults}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restaurar padrões
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Adicione ou remova temas, comunidades, #hashtags ou assuntos de notícias para fixar nos balõezinhos da aba Comunidades.
              </p>

              <div className="flex gap-2">
                <Input
                  id="explore-add-topic"
                  value={newTopicInput}
                  maxLength={36}
                  onChange={(e) => setNewTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTopic();
                    }
                  }}
                  placeholder="Ex: #MeioAmbiente, SUS, Economia..."
                  className="h-9 rounded-xl border-border bg-background text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleAddTopic}
                  disabled={!newTopicInput.trim()}
                  className="h-9 shrink-0 rounded-xl px-3 text-xs"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Fixar
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {visibleDefaultCommunities.map((ct) => (
                  <span
                    key={ct.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    <span>{ct.label.split(' / ')[0]}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveDefaultCommunity(ct.id)}
                      aria-label={`Remover ${ct.label.split(' / ')[0]}`}
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {pinnedTopics.map((topic) => (
                  <span
                    key={topic.id}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    <span>{topic.label}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomTopic(topic.id)}
                      aria-label={`Remover ${topic.label}`}
                      className="rounded-full p-0.5 text-primary/80 hover:bg-primary/20 hover:text-primary"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {visibleDefaultCommunities.length === 0 && pinnedTopics.length === 0 && (
                  <span className="text-[11px] text-muted-foreground italic">
                    Nenhum tema fixado além de &quot;Todas as comunidades&quot;.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border pt-3 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={handleReset} className="rounded-full">
            Todo o Brasil
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving} className="rounded-full px-5">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

