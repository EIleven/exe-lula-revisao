// src/components/profile/ProfilePageSkeleton.tsx
import { Skeleton } from '@/components/ui/skeleton';
import PostCardSkeleton from '@/components/feed/PostCardSkeleton';

export default function ProfilePageSkeleton() {
  return (
    <div>
      {/* Capa / Banner */}
      <div className="relative h-48 bg-muted w-full" />

      <div className="container mx-auto max-w-3xl pb-8 space-y-4">
        <div className="overflow-visible -mt-16">
          <div className="px-4 sm:px-6 pt-6 pb-4 relative">
            {/* Avatar à esquerda + botões arredondados na parte preta abaixo da capa */}
            <div className="flex items-end justify-between gap-2 sm:gap-3">
              <div className="relative -mt-14 shrink-0" style={{ width: '7rem' }}>
                <Skeleton className="h-28 w-28 rounded-full border-4 border-background ring-2 ring-primary/40" />
              </div>
              <div className="flex items-center justify-end gap-1.5 sm:gap-2 pt-11">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 w-9 rounded-full" />
              </div>
            </div>

            {/* Nome, @handle, bio e estatísticas */}
            <div className="mt-4 space-y-3 min-w-0">
              <div className="space-y-2">
                <Skeleton className="h-7 w-48 rounded-md" />
                <Skeleton className="h-4 w-36 rounded-md" />
              </div>

              <div className="space-y-1.5 pt-1">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          </div>
        </div>

        {/* Abas do perfil */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 sm:px-6 py-3 overflow-hidden">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-14" />
        </div>

        {/* Posts com o mesmo PostCardSkeleton real */}
        <div>
          <PostCardSkeleton />
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      </div>
    </div>
  );
}

