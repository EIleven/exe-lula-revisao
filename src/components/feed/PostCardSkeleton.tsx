// src/components/feed/PostCardSkeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function PostCardSkeleton() {
  return (
    <Card className="w-full rounded-none border-x-0 border-b overflow-hidden bg-card relative first:border-t">
      <div className="p-3 md:p-4">
        <div className="flex w-full space-x-3">
          {/* Avatar */}
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          
          <div className="flex-1 min-w-0 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            
            {/* Content */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            
            {/* Media placeholder */}
            <div className="aspect-video w-full rounded-lg overflow-hidden border">
              <Skeleton className="h-full w-full" />
            </div>
            
            {/* Footer */}
            <div className="mt-2 flex justify-around items-center pt-1">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <div className="flex items-center">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8 ml-2" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
