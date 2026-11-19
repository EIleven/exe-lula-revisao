// src/app/[locale]/admin/trends/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, BrainCircuit, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import type { TrendingTopic } from '@/lib/types';
import Link from 'next/link';

const PageSkeleton = () => (
    <div className="container mx-auto max-w-5xl py-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-96" />
        <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4 p-2">
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-4 w-24" />
                </div>
            ))}
        </div>
    </div>
);

export default function TrendsPage() {
    const t = useTranslations('AdminDashboard.trends');
    const { currentUser, isLoading: isLoadingUser } = useCurrentUser();
    const [topics, setTopics] = useState<TrendingTopic[]>([]);
    const [isLoadingTopics, setIsLoadingTopics] = useState(true);

    useEffect(() => {
        if (!currentUser?.isAdmin) return;

        const topicsRef = collection(db, 'trending_topics');
        const q = query(topicsRef, orderBy('pubDate', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedTopics: TrendingTopic[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                fetchedTopics.push({
                    id: doc.id,
                    ...data,
                    pubDate: data.pubDate,
                    fetchedAt: data.fetchedAt,
                } as TrendingTopic);
            });
            setTopics(fetchedTopics);
            setIsLoadingTopics(false);
        }, (error) => {
            console.error("Error fetching trending topics:", error);
            setIsLoadingTopics(false);
        });

        return () => unsubscribe();
    }, [currentUser?.isAdmin]);


    if (isLoadingUser) {
        return <PageSkeleton />;
    }

    if (!currentUser?.isAdmin) {
        return (
            <div className="container mx-auto max-w-3xl py-8 text-center">
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-destructive">Acesso Negado</h1>
                <p className="text-muted-foreground">Você não tem permissão para visualizar esta página.</p>
            </div>
        );
    }
    
    return (
        <div className="container mx-auto max-w-5xl py-8 space-y-6">
             <header>
                <h1 className="text-3xl font-bold flex items-center"><BrainCircuit className="mr-3 h-8 w-8 text-primary"/>{t('title')}</h1>
                <p className="text-muted-foreground">{t('description')}</p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>Notícias Coletadas</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoadingTopics ? (
                        <PageSkeleton />
                    ) : topics.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t('empty')}</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Título</TableHead>
                                    <TableHead>{t('source')}</TableHead>
                                    <TableHead>{t('fetchedAt')}</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {topics.map((topic) => (
                                    <TableRow key={topic.id}>
                                        <TableCell className="font-medium max-w-sm truncate">{topic.title}</TableCell>
                                        <TableCell>{topic.source}</TableCell>
                                        <TableCell>{format(new Date((topic.fetchedAt as Timestamp).seconds * 1000), 'dd/MM/yy HH:mm')}</TableCell>
                                        <TableCell className="text-right">
                                            <Button asChild variant="ghost" size="sm">
                                                <Link href={topic.link} target="_blank" rel="noopener noreferrer">
                                                    <ExternalLink className="h-4 w-4 mr-2" />
                                                    {t('viewOriginal')}
                                                </Link>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
