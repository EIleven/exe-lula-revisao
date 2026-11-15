// src/contexts/CommentSettingsContext.tsx
'use client';

import React, { useState, useEffect, useCallback, ReactNode } from 'react';
import { 
    CommentSettingsContext, 
    defaultSettings,
    type CommentSettings,
    type CommentSortOption,
    type CommentViewOption,
} from '@/hooks/features/comment/useCommentSettings';

const SETTINGS_STORAGE_KEY = 'soberan_comment_settings';

export function CommentSettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<CommentSettings>(defaultSettings);
    const [isInitialized, setIsInitialized] = useState(false);

    // Load initial settings from localStorage on mount
    useEffect(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (storedSettings) {
                const parsedSettings = JSON.parse(storedSettings);
                // Validate parsed settings
                if (['popular', 'oldest', 'newest'].includes(parsedSettings.sort) && ['nested', 'linear'].includes(parsedSettings.view)) {
                    setSettings(parsedSettings);
                }
            }
        } catch (error) {
            console.error("Failed to load comment settings from localStorage:", error);
        }
        setIsInitialized(true);
    }, []);

    const setSort = useCallback((sort: CommentSortOption) => {
        setSettings(currentSettings => {
            const newSettings = { ...currentSettings, sort };
            try {
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
            } catch (error) {
                console.error("Failed to save comment settings:", error);
            }
            return newSettings;
        });
    }, []);

    const setView = useCallback((view: CommentViewOption) => {
        setSettings(currentSettings => {
            const newSettings = { ...currentSettings, view };
            try {
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
            } catch (error) {
                console.error("Failed to save comment settings:", error);
            }
            return newSettings;
        });
    }, []);

    const value = {
        settings: isInitialized ? settings : defaultSettings,
        setSort,
        setView
    };

    return (
        <CommentSettingsContext.Provider value={value}>
            {children}
        </CommentSettingsContext.Provider>
    );
}
