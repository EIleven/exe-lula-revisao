'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { Conversation, User } from '@/lib/types';
import {
  addGroupParticipants,
  removeGroupParticipant,
  setGroupParticipantAdmin,
  updateGroupName,
} from '@/lib/services/conversationService';
import { searchUsers } from '@/lib/services/userService';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Check,
  Loader2,
  Search,
  Shield,
  ShieldOff,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';

interface GroupManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation;
  currentUserId: string;
}

export function GroupManagementDialog({
  open,
  onOpenChange,
  conversation,
  currentUserId,
}: GroupManagementDialogProps) {
  const { toast } = useToast();
  const isAdmin = Boolean(conversation.adminIds?.includes(currentUserId));
  const [tab, setTab] = useState<'members' | 'add'>('members');
  const [groupNameInput, setGroupNameInput] = useState(conversation.groupName || '');
  const [isSavingName, setIsSavingName] = useState(false);

  const [memberFilter, setMemberFilter] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [addSearchTerm, setAddSearchTerm] = useState('');
  const debouncedAddSearch = useDebounce(addSearchTerm, 300);
  const [rawCandidates, setRawCandidates] = useState<User[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setGroupNameInput(conversation.groupName || '');
      setMemberFilter('');
      setAddSearchTerm('');
      setSelectedToAdd([]);
      setTab('members');
    }
  }, [open, conversation.groupName]);

  useEffect(() => {
    if (!open || !isAdmin || tab !== 'add') return;
    let active = true;
    const loadCandidates = async () => {
      setIsLoadingCandidates(true);
      try {
        const term = debouncedAddSearch.trim();
        const users = await searchUsers(term.length > 1 ? term : '', currentUserId);
        if (!active) return;
        setRawCandidates(users);
      } catch (err) {
        console.error('Erro ao buscar candidatos para o grupo:', err);
        if (active) setRawCandidates([]);
      } finally {
        if (active) setIsLoadingCandidates(false);
      }
    };
    void loadCandidates();
    return () => {
      active = false;
    };
  }, [open, isAdmin, tab, debouncedAddSearch, currentUserId]);

  const candidateUsers = useMemo(() => {
    const existingSet = new Set(conversation.participantIds);
    return rawCandidates.filter(
      (u) =>
        !existingSet.has(u.id) &&
        u.dmPreference !== 'none' &&
        !u.hasBlockedCurrentUser &&
        !u.isBlocked
    );
  }, [rawCandidates, conversation.participantIds]);

  const filteredMembers = useMemo(() => {
    const q = memberFilter.trim().toLowerCase();
    const list = [...conversation.participantsInfo];
    list.sort((a, b) => {
      const aCreator = a.id === conversation.createdBy ? 0 : 1;
      const bCreator = b.id === conversation.createdBy ? 0 : 1;
      if (aCreator !== bCreator) return aCreator - bCreator;
      const aAdm = conversation.adminIds?.includes(a.id) ? 0 : 1;
      const bAdm = conversation.adminIds?.includes(b.id) ? 0 : 1;
      if (aAdm !== bAdm) return aAdm - bAdm;
      return a.name.localeCompare(b.name);
    });
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q)
    );
  }, [conversation.participantsInfo, conversation.createdBy, conversation.adminIds, memberFilter]);

  const remainingSlots = Math.max(0, 1000 - conversation.participantIds.length);

  const handleSaveName = async () => {
    if (!isAdmin || isSavingName) return;
    const trimmed = groupNameInput.trim();
    if (!trimmed || trimmed === (conversation.groupName || '').trim()) return;
    setIsSavingName(true);
    try {
      await updateGroupName(conversation.id, currentUserId, trimmed);
      toast({ title: 'Nome do grupo atualizado' });
    } catch (err: unknown) {
      toast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Não foi possível renomear o grupo.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingName(false);
    }
  };

  const handleToggleAdmin = async (targetUser: User, makeAdmin: boolean) => {
    if (!isAdmin || busyUserId) return;
    setBusyUserId(targetUser.id);
    try {
      await setGroupParticipantAdmin(conversation.id, currentUserId, targetUser.id, makeAdmin);
      toast({
        title: makeAdmin ? 'Admin atribuído' : 'Admin removido',
        description: makeAdmin
          ? `${targetUser.name} agora é administrador(a) do grupo.`
          : `${targetUser.name} não é mais administrador(a).`,
      });
    } catch (err: unknown) {
      toast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Não foi possível atualizar o admin.',
        variant: 'destructive',
      });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemoveMember = async (targetUser: User) => {
    if (!isAdmin || busyUserId) return;
    setBusyUserId(targetUser.id);
    try {
      await removeGroupParticipant(conversation.id, currentUserId, targetUser.id);
      toast({
        title: 'Participante removido',
        description: `${targetUser.name} foi removido(a) do grupo.`,
      });
    } catch (err: unknown) {
      toast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Não foi possível remover o participante.',
        variant: 'destructive',
      });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleToggleCandidate = (userId: string) => {
    setSelectedToAdd((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : prev.length >= remainingSlots
        ? prev
        : [...prev, userId]
    );
  };

  const handleAddSelected = async () => {
    if (!isAdmin || isAdding || selectedToAdd.length === 0) return;
    setIsAdding(true);
    try {
      await addGroupParticipants(conversation.id, currentUserId, selectedToAdd);
      toast({
        title: 'Participantes adicionados',
        description: `${selectedToAdd.length} pessoa(s) adicionada(s) ao grupo.`,
      });
      setSelectedToAdd([]);
      setTab('members');
    } catch (err: unknown) {
      toast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Não foi possível adicionar participantes.',
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1.25rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background p-4 sm:p-6">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg font-bold">
            <Users className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">{conversation.groupName || 'Grupo'}</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {conversation.participantIds.length} / 1000 participantes
            {isAdmin ? ' · Você é administrador(a)' : ''}
          </DialogDescription>
        </DialogHeader>

        {isAdmin && (
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={groupNameInput}
              maxLength={80}
              onChange={(e) => setGroupNameInput(e.target.value)}
              placeholder="Nome do grupo"
              className="min-w-0 flex-1 rounded-xl border-border bg-muted/30"
            />
            <Button
              size="sm"
              onClick={handleSaveName}
              disabled={
                isSavingName ||
                !groupNameInput.trim() ||
                groupNameInput.trim() === (conversation.groupName || '').trim()
              }
              className="rounded-xl shrink-0"
            >
              {isSavingName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </div>
        )}

        {isAdmin && (
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2 rounded-full border border-border bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => setTab('members')}
              className={cn(
                'flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs sm:text-sm font-medium transition-colors',
                tab === 'members'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Membros ({conversation.participantIds.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('add')}
              className={cn(
                'flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs sm:text-sm font-medium transition-colors',
                tab === 'add'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Adicionar</span>
            </button>
          </div>
        )}

        {tab === 'members' ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filtrar participantes..."
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="pl-9 rounded-full border-border bg-muted/30"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
              <div className="space-y-2">
                {filteredMembers.map((member) => {
                  const memberIsCreator = member.id === conversation.createdBy;
                  const memberIsAdmin = Boolean(conversation.adminIds?.includes(member.id));
                  const isSelf = member.id === currentUserId;
                  const isBusy = busyUserId === member.id;

                  return (
                    <div
                      key={member.id}
                      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/40 p-2 sm:p-2.5"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
                        <Avatar className="h-8 w-8 sm:h-9 sm:w-9 shrink-0">
                          <AvatarImage src={member.avatarUrl} alt={member.name} />
                          <AvatarFallback>{member.name?.substring(0, 1) || '?'}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1">
                            <p className="truncate max-w-full text-xs sm:text-sm font-semibold text-foreground">
                              {member.name}
                            </p>
                            {isSelf && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                                Você
                              </Badge>
                            )}
                            {memberIsCreator && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary shrink-0">
                                Criador
                              </Badge>
                            )}
                            {memberIsAdmin && (
                              <Badge className="text-[10px] px-1.5 py-0 shrink-0">
                                Admin
                              </Badge>
                            )}
                          </div>
                          <p className="truncate text-[11px] sm:text-xs text-muted-foreground">
                            @{member.username}
                          </p>
                        </div>
                      </div>

                      {isAdmin && !isSelf && !memberIsCreator && (
                        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isBusy}
                            onClick={() => handleToggleAdmin(member, !memberIsAdmin)}
                            title={memberIsAdmin ? 'Remover admin' : 'Tornar admin'}
                            className="h-8 w-8"
                          >
                            {isBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : memberIsAdmin ? (
                              <ShieldOff className="h-4 w-4 text-amber-500" />
                            ) : (
                              <Shield className="h-4 w-4 text-primary" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isBusy}
                            onClick={() => handleRemoveMember(member)}
                            title="Remover do grupo"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum participante encontrado.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar pessoas para adicionar..."
                value={addSearchTerm}
                onChange={(e) => setAddSearchTerm(e.target.value)}
                className="pl-9 rounded-full border-border bg-muted/30"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
              {isLoadingCandidates ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : candidateUsers.length > 0 ? (
                <div className="grid grid-cols-2 min-[380px]:grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-2.5">
                  {candidateUsers.map((user) => {
                    const selected = selectedToAdd.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => handleToggleCandidate(user.id)}
                        className={cn(
                          'group relative flex min-w-0 flex-col items-center rounded-xl border p-2.5 text-center transition-colors',
                          selected
                            ? 'border-primary bg-primary/10'
                            : 'border-border/70 bg-card/40 hover:border-primary/60 hover:bg-muted/40'
                        )}
                      >
                        {selected && (
                          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                        <Avatar className="h-11 w-11 mb-1.5">
                          <AvatarImage src={user.avatarUrl} alt={user.name} />
                          <AvatarFallback>{user.name?.substring(0, 1) || '?'}</AvatarFallback>
                        </Avatar>
                        <p className="w-full truncate text-xs font-semibold text-foreground">
                          {user.name}
                        </p>
                        <p className="w-full truncate text-[11px] text-muted-foreground">
                          @{user.username}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum usuário disponível para adicionar.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">
                {selectedToAdd.length} selecionado(s) · {remainingSlots} vagas restantes
              </span>
              <Button
                onClick={handleAddSelected}
                disabled={isAdding || selectedToAdd.length === 0 || remainingSlots === 0}
                className="rounded-full px-5"
              >
                {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Adicionar
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

