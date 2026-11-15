// src/components/comments/CommentDisplaySettings.tsx
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ListTree, List, ArrowDownUp, Sparkles, Clock, Calendar } from 'lucide-react';
import { useCommentSettings, CommentSortOption, CommentViewOption } from '@/hooks/features/comment/useCommentSettings';
import { useTranslations } from 'next-intl';

const CommentDisplaySettings = () => {
  const t = useTranslations('CommentDisplaySettings');
  const { settings, setSort, setView } = useCommentSettings();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <ArrowDownUp className="mr-2 h-4 w-4" />
          {t('filter')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('view')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={settings.view} onValueChange={(value) => setView(value as CommentViewOption)}>
          <DropdownMenuRadioItem value="nested">
            <ListTree className="mr-2 h-4 w-4" />
            {t('nested')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="linear">
            <List className="mr-2 h-4 w-4" />
            {t('linear')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        
        <DropdownMenuSeparator />

        <DropdownMenuLabel>{t('sortOrder')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={settings.sort} onValueChange={(value) => setSort(value as CommentSortOption)}>
          <DropdownMenuRadioItem value="popular">
            <Sparkles className="mr-2 h-4 w-4" />
            {t('popularFirst')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="oldest">
            <Calendar className="mr-2 h-4 w-4" />
            {t('oldestFirst')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="newest">
            <Clock className="mr-2 h-4 w-4" />
            {t('newestFirst')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CommentDisplaySettings;
