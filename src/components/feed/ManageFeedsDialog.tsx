// src/components/feed/ManageFeedsDialog.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, PlusCircle, Trash2, Edit, Pin, PinOff } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { SUPPORTED_TRANSLATION_LANGUAGES } from '@/lib/i18n/translationPreferences';
import type { User, CustomFeed, TabPreferences } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  getCustomFeeds,
  createCustomFeed,
  updateCustomFeed,
  deleteCustomFeed,
  updateTabPreferences,
} from '@/lib/services/userService';
import EditFeedDialog from './EditFeedDialog';

interface ManageFeedsDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreferencesChanged: () => void;
}

export default function ManageFeedsDialog({ user, open, onOpenChange, onPreferencesChanged }: ManageFeedsDialogProps) {
  const [customFeeds, setCustomFeeds] = useState<CustomFeed[]>([]);
  const [tabPrefs, setTabPrefs] = useState<TabPreferences>({ hidden: [], pinnedOrder: [], feedLanguageFilter: 'all' });
  const [isLoading, setIsLoading] = useState(true);
  const [editingFeed, setEditingFeed] = useState<Partial<CustomFeed> | null>(null);
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();

  useEffect(() => {
    if (!open) {
      setEditingFeed(null);
      return;
    }
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const rawPrefs = user.tabPreferences;
        const normalizedPrefs: TabPreferences = {
          hidden: Array.isArray(rawPrefs?.hidden) ? rawPrefs.hidden : [],
          pinnedOrder: Array.isArray(rawPrefs?.pinnedOrder) ? rawPrefs.pinnedOrder : [],
          feedLanguageFilter: rawPrefs?.feedLanguageFilter || 'all',
        };
        const [feeds, prefs] = await Promise.all([
          getCustomFeeds(user.id),
          Promise.resolve(normalizedPrefs),
        ]);
        setCustomFeeds(feeds);
        setTabPrefs(prefs);
      } catch (error) {
        toast({ title: 'Erro', description: 'Não foi possível carregar seus feeds.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [open, user.id, user.tabPreferences, toast]);

  const handleSaveFeed = async (feedData: { id?: string; name: string; userIds: string[] }) => {
    try {
      if (feedData.id) { // Editing existing feed
        await updateCustomFeed(user.id, feedData.id, { name: feedData.name, userIds: feedData.userIds });
        setCustomFeeds(prev => prev.map(f => f.id === feedData.id ? { ...f, name: feedData.name, userIds: feedData.userIds } : f));
        toast({ title: 'Feed atualizado com sucesso!' });
      } else { // Creating new feed
        const newFeed = await createCustomFeed(user.id, { name: feedData.name, userIds: feedData.userIds });
        setCustomFeeds(prev => [...prev, newFeed]);
        toast({ title: 'Feed criado com sucesso!' });
      }
      onPreferencesChanged();
      setEditingFeed(null);
    } catch (error: any) {
      toast({ title: 'Erro ao salvar feed', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteFeed = async (feedId: string) => {
    if (window.confirm('Tem certeza que deseja deletar este feed?')) {
      try {
        await deleteCustomFeed(user.id, feedId);
        setCustomFeeds(prev => prev.filter(f => f.id !== feedId));
        // Also remove from pinned if it was pinned
        handleTogglePin(feedId, true);
        toast({ title: 'Feed deletado.' });
      } catch (error: any) {
        toast({ title: 'Erro ao deletar feed', description: error.message, variant: 'destructive' });
      }
    }
  };

  const handleTogglePin = async (feedId: string, isCurrentlyPinned: boolean) => {
    const newPinnedOrder = isCurrentlyPinned
      ? tabPrefs.pinnedOrder.filter(id => id !== feedId)
      : [...tabPrefs.pinnedOrder, feedId];
    
    const newPrefs = { ...tabPrefs, pinnedOrder: newPinnedOrder };
    const oldPrefs = { ...tabPrefs };
    setTabPrefs(newPrefs); // Optimistic update
    try {
      await updateTabPreferences(user.id, newPrefs);
      onPreferencesChanged();
    } catch (error) {
      // Revert on error
      setTabPrefs(oldPrefs);
      toast({ title: 'Erro ao fixar feed', variant: 'destructive'});
    }
  };
  
  const handleToggleHideDefault = async (tabId: TabPreferences['hidden'][number], isChecked: boolean) => {
    const isCurrentlyHidden = tabPrefs.hidden.includes(tabId);
    let newHiddenList: TabPreferences['hidden'] = [...tabPrefs.hidden];

    if (isChecked && isCurrentlyHidden) {
      newHiddenList = newHiddenList.filter(id => id !== tabId);
    } else if (!isChecked && !isCurrentlyHidden) {
      newHiddenList.push(tabId);
    } else {
      return;
    }

    const newPrefs: TabPreferences = { ...tabPrefs, hidden: newHiddenList };
    const oldPrefs = { ...tabPrefs };
    setTabPrefs(newPrefs);

    try {
      await updateTabPreferences(user.id, newPrefs);
      onPreferencesChanged();
    } catch (error) {
      setTabPrefs(oldPrefs);
      toast({ title: 'Erro ao salvar preferência', variant: 'destructive'});
    }
  };


  const handleFeedLanguageChange = async (lang: string) => {
    const newPrefs: TabPreferences = { ...tabPrefs, feedLanguageFilter: lang };
    const oldPrefs = { ...tabPrefs };
    setTabPrefs(newPrefs);
    try {
      await updateTabPreferences(user.id, newPrefs);
      await refreshCurrentUser();
      onPreferencesChanged();
      toast({
        title: 'Filtro de idioma atualizado',
        description:
          lang === 'all'
            ? 'Os feeds agora mostram posts em todos os idiomas.'
            : 'Os feeds agora exibem apenas posts no idioma selecionado.',
      });
    } catch {
      setTabPrefs(oldPrefs);
      toast({ title: 'Erro ao salvar filtro de idioma', variant: 'destructive' });
    }
  };

  if (editingFeed !== null) {
    return <EditFeedDialog feed={editingFeed} onSave={handleSaveFeed} onOpenChange={() => setEditingFeed(null)} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-border/80 bg-card p-0 shadow-2xl sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b border-border/60 p-6 pb-4 pr-12 text-left">
          <DialogTitle>Gerenciar Feeds e Abas</DialogTitle>
          <DialogDescription>
            Crie feeds personalizados, fixe-os como abas e gerencie a visibilidade das abas padrão.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center items-center h-64 p-6"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-6">
            <div className="space-y-2">
                <h3 className="font-semibold">Abas Padrão</h3>
                <div className="rounded-lg border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="show-following">Seguindo</Label>
                        <Switch id="show-following" checked={!tabPrefs.hidden.includes('following')} onCheckedChange={(isVisible) => handleToggleHideDefault('following', isVisible)} />
                    </div>
                     <div className="flex items-center justify-between">
                        <Label htmlFor="show-explore">Explorar</Label>
                        <Switch id="show-explore" checked={!tabPrefs.hidden.includes('explore')} onCheckedChange={(isVisible) => handleToggleHideDefault('explore', isVisible)} />
                    </div>
                     <div className="flex items-center justify-between">
                        <Label htmlFor="show-articles">Artigos</Label>
                        <Switch id="show-articles" checked={!tabPrefs.hidden.includes('articles')} onCheckedChange={(isVisible) => handleToggleHideDefault('articles', isVisible)} />
                    </div>
                </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Filtro de Idioma nos Feeds</h3>
              <div className="rounded-lg border p-4 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="feed-language-filter">Exibir posts apenas em</Label>
                  <p className="text-xs text-muted-foreground">
                    Oculta nos feeds posts em outros idiomas (contas internas e Fediverso/Bluesky), mesmo que você siga o autor.
                  </p>
                </div>
                <Select
                  value={tabPrefs.feedLanguageFilter || 'all'}
                  onValueChange={(value) => void handleFeedLanguageChange(value)}
                >
                  <SelectTrigger id="feed-language-filter" className="w-full sm:w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os idiomas</SelectItem>
                    {SUPPORTED_TRANSLATION_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        Apenas {lang.code === 'pt' ? 'Português (PT-BR)' : lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Feeds Personalizados</h3>
                <Button size="sm" variant="outline" onClick={() => setEditingFeed({})}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Criar Novo
                </Button>
              </div>
              <ScrollArea className="h-[250px] border rounded-lg p-2">
                {customFeeds.length > 0 ? (
                  customFeeds.map(feed => {
                    const isPinned = tabPrefs.pinnedOrder.includes(feed.id);
                    return (
                      <div key={feed.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{feed.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {feed.userIds.length} {feed.userIds.length === 1 ? 'usuário' : 'usuários'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleTogglePin(feed.id, isPinned)}>
                            {isPinned ? <PinOff className="h-4 w-4 text-primary" /> : <Pin className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingFeed(feed)}><Edit className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteFeed(feed.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-10">Você ainda não criou nenhum feed personalizado.</p>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
        <DialogFooter className="shrink-0 border-t border-border/60 p-6 pt-4">
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
