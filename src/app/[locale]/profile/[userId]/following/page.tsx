// src/app/profile/[userId]/following/page.tsx
'use client'; // Convert to a client component

import React from 'react';
import UserListClientPage from '@/components/profile/UserListClientPage';
import { notFound, useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';

// Since this is a client component, we cannot use async functions for the component itself.
// All data fetching will be handled inside UserListClientPage.
export default function FollowingPage() {
    const t = useTranslations('FollowingPage');
    const locale = useLocale();
    const params = useParams();
    const profileUserId = params.userId as string;
    
    if (!profileUserId) {
        notFound();
    }

    // The UserListClientPage component will now be responsible for fetching its own data.
    return (
        <UserListClientPage
            listType="following"
            profileUserId={profileUserId}
            pageTitle={t('title')}
            // The description and backLabel will be fetched and set inside the component
            // as it needs to fetch the profileUser first.
            backLink={`/${locale}/profile/${profileUserId}`}
            emptyStateText={t('emptyState', { username: '...' })} // Placeholder username
            iconName="users"
        />
    );
}
