// src/components/analytics/PostAnalyticsDialog.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { Post } from '@/lib/types';
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
import { Eye, Zap, User, ExternalLink, X, Loader2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { getPostAnalytics, PostAnalyticsData } from '@/lib/services/analyticsService';
import { Skeleton } from '../ui/skeleton';

interface PostAnalyticsDialogProps {
  post: Post;
}

const StatCard = ({ title, value, icon: Icon, isLoading }: { title: string; value: string | number; icon: React.ElementType, isLoading: boolean }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-2xl font-bold">{value.toLocaleString()}</div>}
    </CardContent>
  </Card>
);

const ChartSkeleton = () => (
    <div className="w-full h-[250px] p-4">
        <Skeleton className="h-full w-full" />
    </div>
);


export default function PostAnalyticsDialog({ post }: PostAnalyticsDialogProps) {
  const [analyticsData, setAnalyticsData] = useState<PostAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false); // To prevent re-fetching on re-renders

  useEffect(() => {
    // Only fetch if we have a post ID and haven't fetched data for this instance of the dialog yet.
    if (post.id && !hasFetched.current) {
      hasFetched.current = true; // Mark as fetched immediately to prevent loops
      setIsLoading(true);
      setError(null);
      getPostAnalytics(post.id)
        .then(data => {
          if (data) {
            setAnalyticsData(data);
          } else {
            setError("Não foi possível carregar os dados de análise. O post pode ter sido deletado.");
          }
        })
        .catch((err) => {
           console.error("Error fetching analytics:", err);
           setError("Ocorreu um erro inesperado ao buscar os dados de análise.");
        })
        .finally(() => setIsLoading(false));
    }
  }, [post.id]); // Dependency on post.id allows re-fetch if a different post's dialog is opened.

  const engagementData = useMemo(() => [
    { name: 'Likes', value: post.likes || 0 },
    { name: 'Comments', value: post.commentsCount || 0 },
    { name: 'Quotes', value: post.quotesCount || 0 },
    { name: 'Reposts', value: post.reposts || 0 },
  ], [post]);

  const totalEngagements = useMemo(() => {
    return (post.likes || 0) + (post.commentsCount || 0) + (post.quotesCount || 0) + (post.reposts || 0);
  }, [post]);


  return (
    <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0">
      <DialogHeader className="p-6 pb-4 border-b">
        <DialogTitle className="text-lg font-semibold">Análise do Post</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Visão geral do desempenho do seu post.
        </DialogDescription>
      </DialogHeader>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error ? (
           <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <AlertCircle className="w-12 h-12 text-destructive mb-4" />
              <p className="text-destructive font-semibold">Erro ao Carregar Análise</p>
              <p className="text-muted-foreground text-sm">{error}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Impressões" value={analyticsData?.impressions ?? post.views} icon={Eye} isLoading={isLoading}/>
              <StatCard title="Engajamentos" value={totalEngagements} icon={Zap} isLoading={false}/>
              <StatCard title="Cliques no perfil" value={analyticsData?.profileClicks ?? 0} icon={User} isLoading={isLoading}/>
              {/* "Estimadas" porque o marcador por pessoa expira em 90 dias: fora dessa janela a mesma pessoa pode
                  ser contada de novo. Ver src/lib/analytics/markerExpiry.ts. */}
              <StatCard title="Visualizações estimadas" value={analyticsData?.impressions ?? post.views} icon={ExternalLink} isLoading={isLoading}/>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Detalhamento de Engajamento</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? <ChartSkeleton /> : (
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={engagementData} layout="vertical" margin={{ left: 10 }}>
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={80} />
                        <Tooltip
                            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
                            contentStyle={{
                            background: 'hsl(var(--background))',
                            borderColor: 'hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                            }}
                        />
                        <Bar dataKey="value" barSize={20} radius={[0, 4, 4, 0]} fill="hsl(var(--primary))" />
                        </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Visualizações ao Longo do Tempo</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? <ChartSkeleton /> : (
                    <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={analyticsData?.dailyViewsData ?? []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip
                            contentStyle={{
                            background: 'hsl(var(--background))',
                            borderColor: 'hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                            }}
                        />
                        <Area type="monotone" dataKey="views" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
                        </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </DialogContent>
  );
}
