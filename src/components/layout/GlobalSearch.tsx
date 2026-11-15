// src/components/layout/GlobalSearch.tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { performGlobalSearch, type SearchResult } from '@/lib/services/searchService';
import { useDebounce } from '@/hooks/use-debounce';
import { Loader2, Search, Hash, User as UserIcon, History, X } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

const MAX_HISTORY_ITEMS = 5;

interface GlobalSearchProps {
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
}

export default function GlobalSearch({ isExpanded, setIsExpanded }: GlobalSearchProps) {
  const t = useTranslations('GlobalSearch');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const locale = useLocale();
  const isMobile = useIsMobile();
  
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isExpanded]);
  
  // Close search on outside click, ignoring clicks inside the popover content
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      // Check if the click is outside the main container AND not inside the popover content
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !target.parentElement?.closest('[data-radix-popper-content-wrapper]')
      ) {
        setIsExpanded(false);
        setIsPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [containerRef, setIsExpanded]);

  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem('searchHistory');
      if (storedHistory) setSearchHistory(JSON.parse(storedHistory));
    } catch (error) {
      console.error("Failed to parse search history:", error);
      localStorage.removeItem('searchHistory');
    }
  }, []);

  useEffect(() => {
    const search = async () => {
      if (debouncedSearchQuery.length > 1) {
        setIsLoading(true);
        const searchResults = await performGlobalSearch(debouncedSearchQuery);
        setResults(searchResults);
        setIsLoading(false);
        setIsPopoverOpen(true);
      } else {
        setResults(null);
        if (searchQuery.length === 0 && searchHistory.length === 0) {
           setIsPopoverOpen(false);
        }
      }
    };
    search();
  }, [debouncedSearchQuery, searchQuery.length, searchHistory.length]);

  const addToHistory = (term: string) => {
    const newHistory = [term, ...searchHistory.filter(item => item.toLowerCase() !== term.toLowerCase())]
      .slice(0, MAX_HISTORY_ITEMS);
    setSearchHistory(newHistory);
    localStorage.setItem('searchHistory', JSON.stringify(newHistory));
  };

  const removeFromHistory = (e: React.MouseEvent, termToRemove: string) => {
    e.stopPropagation(); e.preventDefault();
    const newHistory = searchHistory.filter(item => item !== termToRemove);
    setSearchHistory(newHistory);
    localStorage.setItem('searchHistory', JSON.stringify(newHistory));
  };

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const term = searchQuery.trim();
    if (term) {
      addToHistory(term);
      setIsPopoverOpen(false);
      setIsExpanded(false);
      // Use router.push for client-side navigation without a full page reload.
      router.push(`/${locale}/search?q=${encodeURIComponent(term)}`);
    }
  };
  
  const handleSelect = (url: string, term?: string) => {
    setIsPopoverOpen(false);
    setIsExpanded(false);
    if (term) addToHistory(term);
    // Use router.push for client-side navigation.
    router.push(url);
    setSearchQuery('');
  };
  
  const handleFocus = () => {
    if (searchQuery.length === 0 && searchHistory.length > 0) {
      setIsPopoverOpen(true);
    } else if (debouncedSearchQuery.length > 1) {
      setIsPopoverOpen(true);
    }
  };

  const showHistory = searchQuery.length === 0 && searchHistory.length > 0;
  const showResults = searchQuery.length > 1;
  
  if (!isExpanded) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsExpanded(true)}
        className="rounded-full h-9 w-9"
      >
        <Search className="h-5 w-5" />
        <span className="sr-only">Search</span>
      </Button>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm sm:max-w-md">
       <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverAnchor asChild>
          <form onSubmit={handleSearchSubmit} className="relative w-full flex items-center">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              type="search"
              placeholder={t('placeholder')}
              className="h-9 rounded-full text-sm pl-9 w-full transition-all bg-muted"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={handleFocus}
            />
          </form>
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] mt-2 p-2"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {showHistory && (
            <div className="space-y-2">
              <div className="flex justify-between items-center px-2">
                <h4 className="font-semibold text-sm flex items-center"><History className="mr-2 h-4 w-4"/>{t('recent')}</h4>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => { setSearchHistory([]); localStorage.setItem('searchHistory', '[]'); }}>{t('clear')}</Button>
              </div>
              {searchHistory.map(term => (
                <div key={term} onClick={() => handleSelect(`/${locale}/search?q=${encodeURIComponent(term)}`, term)} className="flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium leading-none">{term}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => removeFromHistory(e, term)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          
          {showResults && (
            <>
              {isLoading ? (
                <div className="space-y-4 p-2">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="flex items-center space-x-2">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : results && (results.users.length > 0 || results.hashtags.length > 0) ? (
                <div className="space-y-4">
                  {results.users.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm px-2 flex items-center"><UserIcon className="mr-2 h-4 w-4"/>{t('users')}</h4>
                      {results.users.map(user => (
                        <div key={user.id} onClick={() => handleSelect(`/${locale}/profile/${user.id}`, `@${user.username}`)} className="flex items-center gap-3 p-2 rounded-md hover:bg-accent transition-colors cursor-pointer">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={user.avatarUrl} alt={user.name} />
                            <AvatarFallback>{user.name?.[0]}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium leading-none">{user.name}</p>
                            <p className="text-xs text-muted-foreground">@{user.username}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {results.hashtags.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm px-2 flex items-center"><Hash className="mr-2 h-4 w-4"/>{t('topics')}</h4>
                      {results.hashtags.map((tag) => (
                        <div key={tag} onClick={() => handleSelect(`/${locale}/tag/${tag.substring(1)}`, tag)} className="block p-2 rounded-md hover:bg-accent transition-colors cursor-pointer">
                          <p className="text-sm font-medium">{tag}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : debouncedSearchQuery.length > 1 ? (
                <p className="text-sm text-center text-muted-foreground py-4">{t('noResults', { query: debouncedSearchQuery })}</p>
              ) : null }
            </>
          )}

        </PopoverContent>
      </Popover>
    </div>
  );
}
