
// src/components/feed/EditFeedDialog.tsx
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Globe, Loader2, X } from 'lucide-react';
import type { User, CustomFeed } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/use-debounce';
import { searchUsers, getUser } from '@/lib/services/userService'; // Import getUser
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Separator } from '../ui/separator';

const MAX_FEED_USERS = 150;
const FEDI_HANDLE_RE = /^@?[a-zA-Z0-9_.-]{1,64}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

interface EditFeedDialogProps {
  feed: Partial<CustomFeed> | null; // Pass null for creating a new feed
  onSave: (feedData: { id?: string; name: string; userIds: string[] }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export default function EditFeedDialog({ feed, onSave, onOpenChange }: EditFeedDialogProps) {
  const [feedName, setFeedName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const { currentUser, firebaseUser } = useCurrentUser();

  useEffect(() => {
    const fetchInitialUsers = async () => {
      if (feed?.userIds && feed.userIds.length > 0) {
        setIsLoading(true);
        const userPromises = feed.userIds.map(id => getUser(id, currentUser?.id || null));
        const users = (await Promise.all(userPromises)).filter((u): u is User => !!u);
        setSelectedUsers(users);
        setIsLoading(false);
      }
    };

    if (feed) {
      setFeedName(feed.name || '');
      fetchInitialUsers();
    } else {
      setFeedName('');
      setSelectedUsers([]);
    }
  }, [feed, currentUser]);

  useEffect(() => {
    let cancelled = false;
    const performSearch = async () => {
      const trimmed = debouncedSearchQuery.trim();
      if (trimmed.length > 1) {
        setIsSearching(true);
        try {
          const users = await searchUsers(trimmed, currentUser?.id || null);
          const selectedUserIds = new Set(selectedUsers.map(u => u.id));
          let merged = users.filter(u => !selectedUserIds.has(u.id));

          if (FEDI_HANDLE_RE.test(trimmed)) {
            const cleanHandle = trimmed.replace(/^@+/, '').toLowerCase();
            const alreadyMatched = merged.some(u => (u.username || '').toLowerCase() === cleanHandle)
              || selectedUsers.some(u => (u.username || '').toLowerCase() === cleanHandle);
            if (!alreadyMatched) {
              try {
                const token = await firebaseUser?.getIdToken().catch(() => null);
                const res = await fetch(`/api/ap/remote-profile?handle=${encodeURIComponent(cleanHandle)}`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                });
                if (res.ok) {
                  const data = (await res.json()) as { nativeUser?: User };
                  if (data.nativeUser && !selectedUserIds.has(data.nativeUser.id)) {
                    merged = [data.nativeUser, ...merged];
                  }
                }
              } catch {
                // ignora se o servidor remoto não responder
              }
            }
          }

          if (!cancelled) setSearchResults(merged);
        } catch {
          if (!cancelled) toast({ title: "Erro na busca", description: "Não foi possível buscar usuários.", variant: 'destructive' });
        } finally {
          if (!cancelled) setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    };
    performSearch();
    return () => { cancelled = true; };
  }, [debouncedSearchQuery, currentUser, selectedUsers, toast]);

  const addUser = (user: User) => {
    if (selectedUsers.length >= MAX_FEED_USERS) {
      toast({ title: 'Limite de Usuários Excedido', description: `Um feed personalizado pode ter no máximo ${MAX_FEED_USERS} usuários.`, variant: 'destructive' });
      return;
    }
    setSelectedUsers(prev => [user, ...prev]);
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeUser = (userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handleSave = async () => {
    if (!feedName.trim()) {
      toast({ title: 'Nome do Feed é obrigatório', variant: 'destructive' });
      return;
    }
    if (selectedUsers.length > MAX_FEED_USERS) {
      toast({ title: 'Limite de Usuários Excedido', description: `Um feed personalizado pode ter no máximo ${MAX_FEED_USERS} usuários.`, variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    await onSave({
      id: feed?.id,
      name: feedName.trim(),
      userIds: selectedUsers.map(u => u.id),
    });
    setIsLoading(false);
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>{feed?.id ? 'Editar Feed' : 'Criar Novo Feed'}</DialogTitle>
          <DialogDescription>
            {feed?.id ? 'Renomeie ou adicione/remova usuários deste feed.' : `Dê um nome ao seu feed e adicione até ${MAX_FEED_USERS} usuários para começar.`}
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="feed-name">Nome do Feed</Label>
            <Input
              id="feed-name"
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
              placeholder="Ex: Especialistas em IA"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-search">Adicionar Usuários</Label>
            <div className="relative">
                <Input
                  id="user-search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nome, @username ou @user@instancia..."
                />
                {isSearching && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />}
            </div>
            {searchResults.length > 0 && (
              <ScrollArea className="h-[150px] border rounded-md mt-2">
                <div className="p-2 space-y-1">
                  {searchResults.map(user => {
                    const isFedi = user.id.startsWith('ap_') || (user.username ?? '').includes('@');
                    return (
                      <div key={user.id} onClick={() => addUser(user)} className="flex items-center p-2 rounded-md hover:bg-accent cursor-pointer gap-2">
                        <Avatar className="h-8 w-8 shrink-0"><AvatarImage src={user.avatarUrl} /><AvatarFallback>{user.name?.[0] || '?'}</AvatarFallback></Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-sm">{user.name}</span>
                            {isFedi && <Globe className="h-3.5 w-3.5 text-primary shrink-0" />}
                          </div>
                          <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
           {selectedUsers.length > 0 && <Separator />}
           <div className="space-y-2">
            <h4 className="text-sm font-medium">Usuários no Feed ({selectedUsers.length}/{MAX_FEED_USERS})</h4>
            <ScrollArea className="h-[200px] border rounded-md">
                <div className="p-2 space-y-1">
                    {selectedUsers.map(user => {
                        const isFedi = user.id.startsWith('ap_') || (user.username ?? '').includes('@');
                        return (
                          <div key={user.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted gap-2">
                             <div className="flex items-center space-x-2 min-w-0">
                                  <Avatar className="h-8 w-8 shrink-0"><AvatarImage src={user.avatarUrl} /><AvatarFallback>{user.name?.[0] || '?'}</AvatarFallback></Avatar>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="truncate text-sm font-medium">{user.name}</span>
                                      {isFedi && <Globe className="h-3.5 w-3.5 text-primary shrink-0" />}
                                    </div>
                                    <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
                                  </div>
                              </div>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeUser(user.id)}><X className="h-4 w-4" /></Button>
                          </div>
                        );
                    })}
                </div>
            </ScrollArea>
           </div>
        </div>
        <DialogFooter className="p-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isLoading || !feedName.trim()}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
