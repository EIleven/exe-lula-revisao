// src/components/messages/NewConversationDialog.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getUsersFollowedBy, searchUsers } from '@/lib/services/userService';
import { createGroupConversation } from '@/lib/services/conversationService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import type { User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Check, Loader2, Search, Users, UserX, MessageSquare } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { useLocale } from 'next-intl';
import { useUserPresence } from '@/hooks/use-user-presence';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ContactGridTile({
  user,
  selected = false,
  selectionMode = false,
  onSelect,
}: {
  user: User;
  selected?: boolean;
  selectionMode?: boolean;
  onSelect: (user: User) => void;
}) {
  const isOnline = useUserPresence(user.id);

  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      className={cn(
        'group relative flex flex-col items-center rounded-xl border p-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-w-0',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border/70 bg-card/40 hover:border-primary/60 hover:bg-muted/40'
      )}
    >
      {selectionMode && selected && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
      <div className="relative mb-2">
        <Avatar
          className={cn(
            'h-12 w-12 sm:h-14 sm:w-14 ring-1 transition-all',
            selected ? 'ring-primary ring-2' : 'ring-border group-hover:ring-primary/60'
          )}
        >
          <AvatarImage
            src={user.avatarUrl}
            alt={user.name}
            data-ai-hint={user['data-ai-hint'] || 'person avatar'}
          />
          <AvatarFallback>{user.name?.substring(0, 1) || '?'}</AvatarFallback>
        </Avatar>
        {isOnline && (
          <span
            className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-green-500 ring-2 ring-background"
            title="Online"
          />
        )}
      </div>
      <p className="w-full truncate text-xs sm:text-sm font-semibold text-foreground">
        {user.name}
      </p>
      <p className="w-full truncate text-[11px] sm:text-xs text-muted-foreground">
        @{user.username}
      </p>
    </button>
  );
}

export function NewConversationDialog({ open, onOpenChange }: NewConversationDialogProps) {
  const { currentUser, firebaseUser } = useCurrentUser();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [userList, setUserList] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const router = useRouter();
  const locale = useLocale();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setSearchTerm('');
      setGroupName('');
      setSelectedUserIds([]);
      setMode('direct');
    }
  }, [open]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (open && currentUser) {
        setIsLoading(true);
        let users: User[] = [];
        const trimmed = debouncedSearchTerm.trim();
        if (trimmed.length > 1) {
          const isFediverseHandle = /^@?[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed);
          const token = isFediverseHandle ? await firebaseUser?.getIdToken().catch(() => null) : null;
          const [localMatches, remoteUser] = await Promise.all([
            searchUsers(trimmed, currentUser.id),
            isFediverseHandle
              ? fetch(`/api/ap/remote-profile?handle=${encodeURIComponent(trimmed)}`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                })
                  .then((r) => (r.ok ? r.json() : null))
                  .then((d) => (d?.nativeUser ? ({ ...d.nativeUser, dmPreference: 'all' } as User) : null))
                  .catch(() => null)
              : Promise.resolve(null),
          ]);
          users = remoteUser
            ? [remoteUser, ...localMatches.filter((u) => u.id !== remoteUser.id)]
            : localMatches;
        } else {
          users = await getUsersFollowedBy(currentUser.id, currentUser.id);
        }

        const messageableUsers = users.filter(
          (user) =>
            (user.dmPreference !== 'none' || user.id.startsWith('ap_')) &&
            !user.hasBlockedCurrentUser &&
            !user.isBlocked
        );
        setUserList(messageableUsers);
        setIsLoading(false);
      }
    };

    void fetchUsers();
  }, [open, currentUser, debouncedSearchTerm]);

  const handleSelectUser = (user: User) => {
    if (mode === 'direct') {
      onOpenChange(false);
      router.push(`/${locale}/messages/user/${user.id}`);
      return;
    }

    setSelectedUserIds((prev) =>
      prev.includes(user.id)
        ? prev.filter((id) => id !== user.id)
        : prev.length >= 999
        ? prev
        : [...prev, user.id]
    );
  };

  const handleCreateGroup = async () => {
    if (!currentUser || isCreatingGroup) return;
    if (!groupName.trim()) {
      toast({
        title: 'Nome obrigatório',
        description: 'Informe um nome para o grupo.',
        variant: 'destructive',
      });
      return;
    }
    if (selectedUserIds.length === 0) {
      toast({
        title: 'Selecione participantes',
        description: 'Escolha pelo menos uma pessoa para o grupo.',
        variant: 'destructive',
      });
      return;
    }

    setIsCreatingGroup(true);
    try {
      const created = await createGroupConversation(
        currentUser.id,
        selectedUserIds,
        groupName
      );
      onOpenChange(false);
      router.push(`/${locale}/messages/group/${created.id}`);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível criar o grupo.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    } finally {
      setIsCreatingGroup(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1.25rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background p-4 sm:p-6">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle className="text-lg font-bold">
            {mode === 'group' ? 'Novo grupo' : 'Novo chat'}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {mode === 'group'
              ? 'Dê um nome ao grupo e selecione os participantes.'
              : debouncedSearchTerm.trim().length > 1
              ? `Buscando por "${debouncedSearchTerm.trim()}"...`
              : 'Escolha um contato ou pesquise pelo nome ou @username.'}
          </DialogDescription>
        </DialogHeader>

        {/* Seletor: Chat direto | Criar grupo */}
        <div className="grid grid-cols-2 gap-2 rounded-full border border-border bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setMode('direct')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs sm:text-sm font-medium transition-colors',
              mode === 'direct'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat direto
          </button>
          <button
            type="button"
            onClick={() => setMode('group')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs sm:text-sm font-medium transition-colors',
              mode === 'group'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Users className="h-3.5 w-3.5" />
            Criar grupo
          </button>
        </div>

        {mode === 'group' && (
          <div className="space-y-2">
            <Input
              placeholder="Nome do grupo (ex: Coordenação)"
              value={groupName}
              maxLength={80}
              onChange={(e) => setGroupName(e.target.value)}
              className="rounded-xl border-border bg-muted/30"
            />
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar pessoas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 rounded-full border-border bg-muted/30"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
          {mode === 'direct' && currentUser && (
            <button
              type="button"
              onClick={() => handleSelectUser(currentUser)}
              className="mb-3 flex w-full items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} />
                <AvatarFallback>{currentUser.name.substring(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  Mensagens Salvas (Você)
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Anotações privadas, links e rascunhos criptografados
                </p>
              </div>
            </button>
          )}
          {isLoading ? (
            <div className="grid grid-cols-2 min-[380px]:grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-2.5">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center rounded-xl border border-border/50 p-2.5"
                >
                  <Skeleton className="h-12 w-12 sm:h-14 sm:w-14 rounded-full mb-2" />
                  <Skeleton className="h-3.5 w-16 mb-1" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          ) : userList.length > 0 ? (
            <div className="grid grid-cols-2 min-[380px]:grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-2.5">
              {userList.map((user) => (
                <ContactGridTile
                  key={user.id}
                  user={user}
                  selectionMode={mode === 'group'}
                  selected={mode === 'group' && selectedUserIds.includes(user.id)}
                  onSelect={handleSelectUser}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <UserX className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhum contato disponível encontrado.
              </p>
            </div>
          )}
        </div>

        {mode === 'group' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {selectedUserIds.length} selecionado(s) · máx. 1000 no grupo
            </span>
            <Button
              onClick={handleCreateGroup}
              disabled={isCreatingGroup || !groupName.trim() || selectedUserIds.length === 0}
              className="rounded-full px-5"
            >
              {isCreatingGroup ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar grupo
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
