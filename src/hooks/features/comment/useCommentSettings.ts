// src/hooks/features/comment/useCommentSettings.ts
'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export type CommentSortOption = 'popular' | 'oldest' | 'newest';
export type CommentViewOption = 'nested' | 'linear';

export interface CommentSettings {
  sort: CommentSortOption;
  view: CommentViewOption;
}

export const defaultSettings: CommentSettings = {
  sort: 'popular',
  view: 'nested',
};

export interface CommentSettingsContextType {
    settings: CommentSettings;
    setSort: (sort: CommentSortOption) => void;
    setView: (view: CommentViewOption) => void;
}

export const CommentSettingsContext = createContext<CommentSettingsContextType | undefined>(undefined);

export function useCommentSettings() {
  const context = useContext(CommentSettingsContext);
  if (context === undefined) {
    throw new Error('useCommentSettings must be used within a CommentSettingsProvider');
  }
  return context;
}
