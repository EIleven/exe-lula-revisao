// src/components/settings/UserModerationSettings.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, X } from 'lucide-react';
import {
  getBlockedUsers,
  getMutedUsers,
  updateUserSettings,
  toggleBlockUser,
  toggleMuteUser,
} from '@/lib/services/userService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import ManagedUserListItem from './ManagedUserListItem';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';

interface SettingsProps {
  user: User;
}

export default function UserModerationSettings({ user }: SettingsProps) {
  const t = useTranslations('ModerationSettings');
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();

  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);
  const [mutedUsers, setMutedUsers] = useState<User[]>([]);
  const [mutedWords, setMutedWords] = useState<string[]>(user.mutedWords || []);
  const [newMutedWord, setNewMutedWord] = useState('');

  const [isLoadingLists, setIsLoadingLists] = useState(true);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [isUpdatingWords, setIsUpdatingWords] = useState(false);

  const fetchUserLists = useCallback(async () => {
    setIsLoadingLists(true);
    try {
      const [blocked, muted] = await Promise.all([
        getBlockedUsers(user.id),
        getMutedUsers(user.id),
      ]);
      setBlockedUsers(blocked);
      setMutedUsers(muted);
    } catch (error) {
      toast({ title: t('errors.loadLists'), variant: "destructive" });
    } finally {
      setIsLoadingLists(false);
    }
  }, [user.id, toast, t]);

  useEffect(() => {
    fetchUserLists();
  }, [fetchUserLists]);

  useEffect(() => {
    setMutedWords(user.mutedWords || []);
  }, [user.mutedWords]);

  const handleSaveMutedWords = async (newWords: string[]) => {
    setIsUpdatingWords(true);
    try {
      await updateUserSettings(user.id, { mutedWords: newWords });
      setMutedWords(newWords);
      await refreshCurrentUser();
      toast({ title: t('mutedWords.updateSuccess') });
    } catch (error: any) {
      toast({ title: t('errors.updateWords'), variant: "destructive" });
    } finally {
      setIsUpdatingWords(false);
    }
  };

  const handleAddMutedWord = async () => {
    const word = newMutedWord.trim().toLowerCase();
    if (!word || mutedWords.includes(word)) {
      setNewMutedWord('');
      return;
    }
    await handleSaveMutedWords([...mutedWords, word]);
    setNewMutedWord('');
  };

  const handleRemoveMutedWord = async (wordToRemove: string) => {
    const newWords = mutedWords.filter(w => w !== wordToRemove);
    await handleSaveMutedWords(newWords);
  };

  const handleListAction = async (action: 'unblock' | 'unmute', targetUserId: string) => {
    setIsUpdating(targetUserId);
    try {
      if (action === 'unblock') {
        await toggleBlockUser(user.id, targetUserId);
        toast({ title: t('unblockSuccess') });
        setBlockedUsers(prev => prev.filter(u => u.id !== targetUserId));
      } else {
        await toggleMuteUser(user.id, targetUserId);
        toast({ title: t('unmuteSuccess') });
        setMutedUsers(prev => prev.filter(u => u.id !== targetUserId));
      }
      await refreshCurrentUser();
    } catch (error: any) {
      toast({ title: t('errors.updateUser'), variant: "destructive" });
    }
    setIsUpdating(null);
  };

  return (
    <>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">{t('mutedWords.title')}</h3>
          <div className="flex gap-2">
            <Input 
              value={newMutedWord}
              onChange={(e) => setNewMutedWord(e.target.value)}
              placeholder={t('mutedWords.placeholder')}
              onKeyDown={(e) => { if(e.key === 'Enter') { e.preventDefault(); handleAddMutedWord(); } }}
              disabled={isUpdatingWords}
            />
            <Button onClick={handleAddMutedWord} disabled={isUpdatingWords || !newMutedWord.trim()}>
              {isUpdatingWords ? <Loader2 className="h-4 w-4 animate-spin"/> : t('mutedWords.add')}
            </Button>
          </div>
          {mutedWords.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {mutedWords.map(word => (
                <Badge key={word} variant="secondary" className="text-base font-normal">
                  {word}
                  <button onClick={() => handleRemoveMutedWord(word)} className="ml-2 rounded-full p-0.5 hover:bg-destructive/20 text-destructive disabled:opacity-50" disabled={isUpdatingWords}>
                    <X className="h-3 w-3"/>
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">{t('mutedAccounts.title')}</h3>
          {isLoadingLists ? <Skeleton className="h-20 w-full" /> : mutedUsers.length > 0 ? (
            <div className="space-y-1 border rounded-md max-h-72 overflow-y-auto p-2">
              {mutedUsers.map(u => (
                <ManagedUserListItem
                  key={`muted-${u.id}`}
                  user={u}
                  actionLabel={t('mutedAccounts.unmute')}
                  onAction={() => handleListAction('unmute', u.id)}
                  isProcessing={isUpdating === u.id}
                />
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('mutedAccounts.empty')}</p>}
        </div>

        <Separator />

        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">{t('blockedAccounts.title')}</h3>
          {isLoadingLists ? <Skeleton className="h-20 w-full" /> : blockedUsers.length > 0 ? (
            <div className="space-y-1 border rounded-md max-h-72 overflow-y-auto p-2">
              {blockedUsers.map(u => (
                <ManagedUserListItem
                  key={`blocked-${u.id}`}
                  user={u}
                  actionLabel={t('blockedAccounts.unblock')}
                  onAction={() => handleListAction('unblock', u.id)}
                  isProcessing={isUpdating === u.id}
                />
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('blockedAccounts.empty')}</p>}
        </div>
      </CardContent>
    </>
  );
}
