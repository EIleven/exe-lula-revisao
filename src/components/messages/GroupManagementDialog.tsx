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
import { useMessagesHost } from '@/modules/messages';
import { searchUsers } from '@/lib/services/userService';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Check,
  Copy,
  Globe,
  Loader2,
  Mail,
  Megaphone,
  Search,
  Send,
  Share2,
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
  const [tab, setTab] = useState<'members' | 'add' | 'invite'>('members');
  const [groupNameInput, setGroupNameInput] = useState(conversation.groupName || '');
  const [isSavingName, setIsSavingName] = useState(false);

  const [memberFilter, setMemberFilter] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [addSearchTerm, setAddSearchTerm] = useState('');
  const debouncedAddSearch = useDebounce(addSearchTerm, 220);
  const [initialPool, setInitialPool] = useState<User[]>([]);
  const [rawCandidates, setRawCandidates] = useState<User[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [selectedUsersById, setSelectedUsersById] = useState<Record<string, User>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [sendDirectInviteOnAdd, setSendDirectInviteOnAdd] = useState(true);
  const [sendPublicMentionOnAdd, setSendPublicMentionOnAdd] = useState(false);

  const [invitePostText, setInvitePostText] = useState('');
  const [isPublishingPost, setIsPublishingPost] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const messagesHost = useMessagesHost();

  const groupTitle = (conversation.groupName || 'Grupo').trim();
  const inviteLink = useMemo(() => {
    const origin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'https://hiperverso.app';
    return `${origin}/pt-BR/login?federated=fediverse&groupName=${encodeURIComponent(
      groupTitle
    )}&redirect=${encodeURIComponent(`/pt-BR/messages/group/${conversation.id}`)}`;
  }, [conversation.id, groupTitle]);

  useEffect(() => {
    if (open) {
      const title = (conversation.groupName || 'Grupo').trim();
      setGroupNameInput(conversation.groupName || '');
      setMemberFilter('');
      setAddSearchTerm('');
      setSelectedToAdd([]);
      setSelectedUsersById({});
      setTab('members');
      setInvitePostText(
        `Estamos reunidos no grupo "${title}" aqui na rede! Quem quiser chegar junto na conversa entra em 1 toque:\n${inviteLink}`
      );
    }
  }, [open, conversation.groupName, inviteLink]);

  useEffect(() => {
    if (!open || !isAdmin || tab !== 'add') return;
    let active = true;
    const loadCandidates = async () => {
      setIsLoadingCandidates(true);
      try {
        const term = debouncedAddSearch.trim();
        const users = await searchUsers(term.length > 0 ? term : '', currentUserId);
        if (!active) return;
        if (!term) {
          setInitialPool(users);
        }
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
    const liveQuery = addSearchTerm.trim().replace(/^@+/, '').toLowerCase();
    const combinedById = new Map<string, User>();
    for (const u of [...rawCandidates, ...initialPool]) {
      if (!u || combinedById.has(u.id)) continue;
      if (liveQuery) {
        const matchName = (u.name || '').toLowerCase().includes(liveQuery);
        const matchUser = (u.username || '').toLowerCase().includes(liveQuery);
        if (!matchName && !matchUser) continue;
      }
      combinedById.set(u.id, u);
    }
    const filtered = Array.from(combinedById.values()).filter(
      (u) =>
        !existingSet.has(u.id) &&
        (u.dmPreference !== 'none' || u.id.startsWith('ap_') || u.username?.includes('@')) &&
        !u.hasBlockedCurrentUser &&
        !u.isBlocked
    );
    const seen = new Set(filtered.map((u) => u.id));
    const extras: User[] = [];
    for (const id of selectedToAdd) {
      if (!seen.has(id) && !existingSet.has(id) && selectedUsersById[id]) {
        extras.push(selectedUsersById[id]);
      }
    }
    return [...extras, ...filtered];
  }, [rawCandidates, initialPool, addSearchTerm, conversation.participantIds, selectedToAdd, selectedUsersById]);

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

  const handleToggleCandidate = (user: User) => {
    const userId = user.id;
    setSelectedUsersById((prev) => ({ ...prev, [userId]: user }));
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
      const { addedUsers, remoteNotified, recusados } = await addGroupParticipants(
        conversation.id,
        currentUserId,
        selectedToAdd,
        {
          sendFediverseInvite: sendDirectInviteOnAdd,
          sendPublicFediverseMention: sendPublicMentionOnAdd,
        }
      );
      const addedHandles = addedUsers
        .map((u) => (u.username?.startsWith('@') ? u.username : `@${u.username}`))
        .filter(Boolean);
      if (addedHandles.length > 0) {
        setInvitePostText(
          `Boas-vindas a ${addedHandles.join(' ')} no grupo "${groupTitle}"! Quem quiser chegar junto na conversa entra em 1 toque:\n${inviteLink}`
        );
      }
      // Conta quem ENTROU, não quem foi pedido: parte da seleção pode ter sido recusada por escolha da própria
      // pessoa (caixa de entrada fechada, "só de quem eu sigo") ou por bloqueio. Dizer "5 adicionadas" quando
      // entraram 3 é mentir na cara de quem está olhando a lista.
      const quantos = addedUsers.length;
      const partes = [`${quantos} pessoa(s) adicionada(s) ao grupo.`];
      if (remoteNotified > 0) partes.push(`${remoteNotified} convite(s) enviado(s) ao Fediverso.`);
      if (recusados.length > 0) {
        partes.push(recusados.map((r) => `${r.nome} ${r.emPalavras}`).join('; ') + '.');
      }
      toast({
        title: recusados.length > 0 ? 'Adicionado em parte' : 'Participantes adicionados',
        description: partes.join(' '),
      });
      setSelectedToAdd([]);
      setTab('invite');
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

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopiedLink(true);
      toast({ title: 'Link copiado!' });
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  const handleShareNative = async () => {
    const shareText = `Venha participar do grupo "${groupTitle}": ${inviteLink}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: groupTitle,
          text: `Convite para o grupo "${groupTitle}"`,
          url: inviteLink,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    await navigator.clipboard.writeText(shareText).catch(() => {});
    toast({ title: 'Convite copiado para enviar!' });
  };

  const handlePublishInvitePost = async () => {
    const text = invitePostText.trim();
    if (!text || isPublishingPost) return;
    setIsPublishingPost(true);
    try {
      if (!messagesHost.publishGroupInvite) {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          toast({
            title: 'Convite copiado!',
            description: 'Cole onde desejar para convidar outras pessoas.',
          });
        }
        return;
      }
      await messagesHost.publishGroupInvite({
        userId: currentUserId,
        text,
        groupId: conversation.id,
      });
      toast({
        title: 'Convite publicado no Feed!',
        description: 'As pessoas mencionadas também recebem o aviso no Fediverso.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Erro ao publicar',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsPublishingPost(false);
    }
  };

  const handleSendEmailInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const to = inviteEmail.trim();
    if (!to) return;
    const subject = encodeURIComponent(`Convite para o grupo "${groupTitle}"`);
    const body = encodeURIComponent(
      `Olá!\n\nVocê foi convidado(a) para participar do grupo "${groupTitle}".\n\nPara entrar direto na conversa em 1 clique:\n${inviteLink}\n\nAté lá!`
    );
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
    toast({ title: 'Abrindo seu aplicativo de e-mail...' });
  };

  const toggleMentionInPost = (username: string) => {
    const handle = username.startsWith('@') ? username : `@${username}`;
    setInvitePostText((prev) =>
      prev.includes(handle) ? prev : `${handle} ${prev}`
    );
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
          <div className="grid grid-cols-3 gap-1 rounded-full border border-border bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => setTab('members')}
              className={cn(
                'flex min-w-0 items-center justify-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
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
                'flex min-w-0 items-center justify-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
                tab === 'add'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Adicionar</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('invite')}
              className={cn(
                'flex min-w-0 items-center justify-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
                tab === 'invite'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Megaphone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Convidar</span>
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
        ) : tab === 'add' ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar pessoas ou @usuario@dominio..."
                value={addSearchTerm}
                onChange={(e) => setAddSearchTerm(e.target.value)}
                className="pl-9 pr-9 rounded-full border-border bg-muted/30"
              />
              {isLoadingCandidates && (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
              {isLoadingCandidates && candidateUsers.length === 0 ? (
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
                        onClick={() => handleToggleCandidate(user)}
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

            <div className="space-y-2 border-t border-border pt-2.5">
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={sendDirectInviteOnAdd}
                    onCheckedChange={(v) => setSendDirectInviteOnAdd(Boolean(v))}
                  />
                  <span>Enviar convite direto com link 1-toque</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={sendPublicMentionOnAdd}
                    onCheckedChange={(v) => setSendPublicMentionOnAdd(Boolean(v))}
                  />
                  <span>Notificar também por menção pública</span>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
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
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
            {/* 1. Link direto em 1 toque */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">
                  Link de entrada em 1 toque
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyInviteLink}
                    className="h-7 rounded-full px-2.5 text-xs"
                  >
                    {copiedLink ? (
                      <Check className="mr-1 h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="mr-1 h-3.5 w-3.5" />
                    )}
                    {copiedLink ? 'Copiado' : 'Copiar'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleShareNative}
                    className="h-7 rounded-full px-2.5 text-xs"
                  >
                    <Share2 className="mr-1 h-3.5 w-3.5" />
                    Compartilhar
                  </Button>
                </div>
              </div>
              <p className="truncate rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                {inviteLink}
              </p>
            </div>

            {/* 2. Postar convite no Feed / Fediverso marcando pessoas */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  Chamar pelo Feed e Fediverso
                </p>
                <span className="text-[11px] text-muted-foreground">
                  Toque em um @ para marcar
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                {conversation.participantsInfo
                  .filter((p) => p.id !== currentUserId && (p.id.startsWith('ap_') || p.username?.includes('@')))
                  .slice(0, 12)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleMentionInPost(p.username)}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] text-foreground hover:border-primary/50"
                    >
                      <span>@{p.username}</span>
                    </button>
                  ))}
              </div>

              <Textarea
                value={invitePostText}
                onChange={(e) => setInvitePostText(e.target.value)}
                rows={3}
                className="text-xs rounded-xl bg-background/80"
                placeholder="Escreva o convite..."
              />

              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={handlePublishInvitePost}
                  disabled={isPublishingPost || !invitePostText.trim()}
                  className="rounded-full px-4 text-xs"
                >
                  {isPublishingPost ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Publicar convite no Feed
                </Button>
              </div>
            </div>

            {/* 3. Convidar por e-mail */}
            <form
              onSubmit={handleSendEmailInvite}
              className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-2"
            >
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-primary" />
                Convidar por e-mail
              </p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                  className="h-8 rounded-xl bg-background/80 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!inviteEmail.trim()}
                  className="h-8 rounded-full px-3 text-xs shrink-0"
                >
                  Enviar e-mail
                </Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

