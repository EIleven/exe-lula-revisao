// src/app/[locale]/admin/page.tsx
'use client';

import React from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';
import AdminDashboard from '@/components/profile/AdminDashboard';

const PageSkeleton = () => (
    <div className="container mx-auto max-w-5xl py-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-12 w-full" />
        <div className="grid md:grid-cols-2 gap-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
        </div>
    </div>
);

export default function AdminPage() {
    const { currentUser, isLoading } = useCurrentUser();

    if (isLoading) {
        return <PageSkeleton />;
    }

    if (!currentUser?.isAdmin && !currentUser?.isModerator) {
        return (
            <div className="container mx-auto max-w-3xl py-8 text-center">
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-destructive">Acesso Negado</h1>
                <p className="text-muted-foreground">Você não tem permissão para visualizar esta página.</p>
            </div>
        );
    }
    
    return (
      <AdminDashboard activeUser={currentUser} />
    );
}
