import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function MessagesLoading() {
  return (
    <div className="altura-da-conversa flex w-full border-x border-border bg-background">
      <div className="w-full min-[800px]:w-[340px] lg:w-[380px] shrink-0 border-r border-border p-4 space-y-4">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-10 w-full rounded-full" />
        <div className="space-y-3 pt-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-44" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hidden min-[800px]:flex flex-1 flex-col items-center justify-center p-6">
        <Skeleton className="h-12 w-12 rounded-full mb-3" />
        <Skeleton className="h-5 w-44 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  );
}

