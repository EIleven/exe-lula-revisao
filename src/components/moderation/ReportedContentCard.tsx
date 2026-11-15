// src/components/moderation/ReportedContentCard.tsx
'use client';

import React from 'react';
import type { ReportedItem } from '@/lib/services/moderationService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PostCard from '@/components/feed/PostCard';
import CommentCard from '@/components/feed/CommentCard';
import { format } from 'date-fns';
import { AlertCircle, Check, Trash2, User } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from 'next-intl';

interface ReportedContentCardProps {
    item: ReportedItem;
    onIgnore: (reportId: string, contentId: string) => void;
    onRemove: (reportId: string, item: ReportedItem) => void;
}

export default function ReportedContentCard({ item, onIgnore, onRemove }: ReportedContentCardProps) {
  const locale = useLocale();
  const { reportId, reportedContent, contentType, reason, reporterInfo, reportCreatedAt } = item;

  return (
    <Card className="bg-muted/30 border-destructive/50">
        <CardHeader>
             <CardDescription className="flex justify-between items-center text-xs">
                <span>
                    Reportado por <Link href={`/${locale}/profile/${reporterInfo.id}`} className="font-semibold text-foreground hover:underline">@{reporterInfo.username}</Link> em {format(new Date(reportCreatedAt), "dd/MM/yyyy 'às' HH:mm")}
                </span>
                 <span className="font-semibold text-destructive flex items-center">
                    <AlertCircle className="h-4 w-4 mr-1.5" />
                    MOTIVO: {reason}
                </span>
            </CardDescription>
        </CardHeader>
        <CardContent>
            {contentType === 'post' && reportedContent ? (
                <PostCard post={reportedContent} />
            ) : contentType === 'comment' && reportedContent ? (
                <CommentCard comment={reportedContent} />
            ) : (
                <p className="text-destructive-foreground p-4 bg-destructive rounded-md">O conteúdo reportado não pode ser carregado ou foi deletado.</p>
            )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onIgnore(reportId, reportedContent.id)}>
                <Check className="h-4 w-4 mr-2"/>
                Ignorar Reporte
            </Button>
            <Button variant="destructive" size="sm" onClick={() => onRemove(reportId, item)}>
                <Trash2 className="h-4 w-4 mr-2"/>
                Remover Conteúdo
            </Button>
        </CardFooter>
    </Card>
  )
}
