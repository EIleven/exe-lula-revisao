// src/components/mentions/MentionSuggestions.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from '@/components/ui/command';
import { searchUsers } from '@/lib/services/userService';
import { getTopHashtags } from '@/lib/services/hashtagService';
import type { User } from '@/lib/types';
import { Loader2, Hash, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useDebounce } from '@/hooks/use-debounce';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import type { SuggestionType } from '@/hooks/features/mentions/useMentions';
import { siteConfig } from '@/config/site';
import { parseLocalMentionQuery, plainLocalHandle } from '@/lib/mentions/localAddress';
import { findLocalUserByHandle } from '@/lib/services/localMentionLookup';

const LOCAL_DOMAINS = [siteConfig.federationHost, siteConfig.officialHost, siteConfig.wwwHost];

interface MentionSuggestionsProps {
  type: SuggestionType | null;
  query: string | null;
  onSelect: (value: string) => void;
  side?: 'top' | 'bottom';
  children?: React.ReactNode; // Make children optional if it's only for the trigger
}

const FEDIVERSE_HANDLE_PATTERN = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export default function MentionSuggestions({
  type,
  query,
  onSelect,
  side = 'bottom',
  children, // Receive children
}: MentionSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<(User | { tag: string })[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debouncedQuery = useDebounce(query, 200);
  const { currentUser } = useCurrentUser();

  useEffect(() => {
    if (debouncedQuery === null || !type) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const fetchSuggestions = async () => {
      setIsLoading(true);
      try {
        if (type === 'user') {
          const trimmed = debouncedQuery.trim();
          // `usuario@exercitodolula.app` (inteiro ou começado) é uma pessoa DAQUI: busca pelo handle, nunca pela string toda, e
          // nunca passa pelo resolvedor do Fediverso (que responde "perfil-local" e a pessoa sumia da lista).
          const local = parseLocalMentionQuery(trimmed, LOCAL_DOMAINS);
          const termo = local ? local.handle : trimmed;
          const users = await searchUsers(termo, currentUser?.id || null);
          // Busca exata pelo índice `usernames`, que ignora a caixa: `searchUsers` não acha `ExercitoDoLula` (ver localMentionLookup.ts).
          const exatoHandle = local ? (local.handle.length >= 3 ? local.handle : null) : plainLocalHandle(trimmed);
          if (exatoHandle && !users.some((u) => u.username?.toLowerCase() === exatoHandle)) {
            const exato = await findLocalUserByHandle(exatoHandle, currentUser?.id || null);
            if (exato) users.unshift(exato);
          }
          let combined = users;

          if (!local && FEDIVERSE_HANDLE_PATTERN.test(trimmed)) {
            const lower = trimmed.toLowerCase();
            const alreadyPresent = users.some((u) => u.username?.toLowerCase() === lower);
            if (!alreadyPresent) {
              try {
                const res = await fetch(`/api/ap/lookup?q=${encodeURIComponent(trimmed)}`);
                if (res.ok) {
                  const remote = await res.json();
                  if (remote?.handle) {
                    const remoteUser: User = {
                      id: `ap_lookup_${remote.handle}`,
                      name: remote.name || remote.handle,
                      username: remote.handle,
                      email: '',
                      avatarUrl: remote.iconUrl || '',
                      bio: remote.summary || '',
                      followersCount: 0,
                      followingCount: 0,
                      postsCount: 0,
                      dmPreference: 'none',
                      isAdmin: false,
                      isModerator: false,
                      createdAt: new Date().toISOString(),
                    };
                    combined = [remoteUser, ...users];
                  }
                }
              } catch {
                // Ignore transient remote lookup errors while typing
              }
            }
          }

          if (!cancelled) {
            setSuggestions(combined);
          }
        } else if (type === 'hashtag') {
          const hashtags = await getTopHashtags(100); // Fetch a larger list
          const filteredHashtags = hashtags
            .filter(ht => ht.tag.toLowerCase().includes(debouncedQuery.toLowerCase()))
            .map(ht => ({ tag: ht.tag.substring(1) })); // Store without '#'
          if (!cancelled) {
            setSuggestions(filteredHashtags);
          }
        }
      } catch (error) {
        console.error("Failed to fetch suggestions:", error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchSuggestions();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, type, currentUser?.id]);

  return (
    <PopoverContent
      className="w-80 p-0"
      onOpenAutoFocus={(e) => e.preventDefault()}
      side={side}
      align="start"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query || ''}
          placeholder={type === 'user' ? "Buscar usuário..." : "Buscar hashtag..."}
          className="h-9"
          disabled={true} // Input is controlled by the textarea
        />
        <CommandList>
          {isLoading && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && suggestions.length === 0 && query && (
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
          )}
          {suggestions.map((item, index) => {
            if ('username' in item) { // It's a User
              return (
                <CommandItem
                  key={item.id}
                  onSelect={() => onSelect(item.username)}
                  value={item.username}
                >
                  <Avatar className="mr-2 h-6 w-6 shrink-0">
                    <AvatarImage src={item.avatarUrl} alt={item.name} />
                    <AvatarFallback>{item.name?.[0]}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium truncate">{item.name}</span>
                  <span className="ml-2 text-muted-foreground truncate text-xs">@{item.username}</span>
                </CommandItem>
              );
            } else { // It's a Hashtag
              return (
                <CommandItem
                  key={item.tag + index}
                  onSelect={() => onSelect(item.tag)}
                  value={item.tag}
                >
                   <div className="mr-2 grid h-6 w-6 place-items-center rounded-full bg-muted">
                      <Hash className="h-4 w-4" />
                   </div>
                  <span className="font-medium">#{item.tag}</span>
                </CommandItem>
              );
            }
          })}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}
