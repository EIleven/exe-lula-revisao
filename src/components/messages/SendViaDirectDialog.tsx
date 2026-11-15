// src/components/messages/SendViaDirectDialog.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getUsersFollowedBy, searchUsers } from '@/lib/services/userService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import type { User, Post } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, UserX, Loader2 } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { getOrCreateConversation, sendDirectMessage } from '@/lib/services/conversationService';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useLocale, useTranslations } from 'next-intl';

interface SendViaDirectDialogProps {
  post: Post;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const UserItem = ({ user, onSelect, isSending }: { user: User, onSelect: (userId: string) => void, isSending: boolean }) => {
  return (
    <div onClick={() => !isSending && onSelect(user.id)} className="flex items-center p-2 -mx-2 rounded-lg hover:bg-muted transition-colors cursor-pointer">
      <Avatar className="h-10 w-10 mr-3">
        <AvatarImage src={user.avatarUrl} alt={user.name} data-ai-hint={user['data-ai-hint'] || "person avatar"} />
        <AvatarFallback>{user.name?.substring(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate">{user.name}</p>
        <p className="text-sm text-muted-foreground truncate">@{user.username}</p>
      </div>
      {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 text-muted-foreground" />}
    </div>
  );
};

export default function SendViaDirectDialog({ post, open, onOpenChange }: SendViaDirectDialogProps) {
  const { currentUser } = useCurrentUser();
  const { toast } = useToast();
  const router = useRouter();
  const [userList, setUserList] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const locale = useLocale();
  const t = useTranslations('SendViaDirectDialog');

  useEffect(() => {
    const fetchUsers = async () => {
      if (open && currentUser) {
        setIsLoading(true);
        let users: User[] = [];
        if (debouncedSearchTerm.length > 1) {
          users = await searchUsers(debouncedSearchTerm, currentUser.id);
        } else {
          users = await getUsersFollowedBy(currentUser.id, currentUser.id);
        }

        const messageableUsers = users.filter(user => 
          user.dmPreference !== 'none' && !user.hasBlockedCurrentUser && !user.isBlocked
        );
        setUserList(messageableUsers);
        setIsLoading(false);
      }
    };
    fetchUsers();
  }, [open, currentUser, debouncedSearchTerm]);

  const handleSelectUser = async (recipientId: string) => {
    if (!currentUser || isSending) return;
    setIsSending(recipientId);

    try {
        const conversation = await getOrCreateConversation(currentUser.id, recipientId);
        if (!conversation) {
            throw new Error("Could not create or find a conversation.");
        }

        await sendDirectMessage(conversation.id, currentUser.id, {
            sharedPostId: post.id,
            text: t('shareMessage'),
        });

        toast({
            title: "Post Sent!",
            description: (
                <Button variant="link" onClick={() => router.push(`/${locale}/messages/user/${recipientId}`)} className="p-0 h-auto">
                    View conversation
                </Button>
            ),
        });
        onOpenChange(false);

    } catch (error: any) {
        toast({
            title: "Failed to send",
            description: error.message || "An unexpected error occurred.",
            variant: "destructive"
        });
    } finally {
        setIsSending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar Post por Mensagem Direta</DialogTitle>
          <DialogDescription>
            Selecione um usuário para compartilhar este post.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Input
            placeholder="Buscar usuários..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <ScrollArea className="h-[400px] mt-4">
          <div className="pr-4">
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div>
                  </div>
                ))}
              </div>
            ) : userList.length > 0 ? (
              <div className="space-y-1">
                {userList.map(user => (
                  <UserItem key={user.id} user={user} onSelect={handleSelectUser} isSending={isSending === user.id} />
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                 <UserX className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
