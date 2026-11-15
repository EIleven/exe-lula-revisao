import PostCardSkeleton from '@/components/feed/PostCardSkeleton';
import PostPageHeader from './PostPageHeader';

export default function PostLoading() {
  return (
    <main className="w-full min-w-0">
      <PostPageHeader text="Post" />
      <PostCardSkeleton />
    </main>
  );
}

