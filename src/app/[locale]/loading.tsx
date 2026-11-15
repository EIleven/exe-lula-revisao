import PostCardSkeleton from '@/components/feed/PostCardSkeleton';

export default function LocaleSegmentLoading() {
  return (
    <div className="w-full min-w-0">
      <PostCardSkeleton />
      <PostCardSkeleton />
      <PostCardSkeleton />
    </div>
  );
}

