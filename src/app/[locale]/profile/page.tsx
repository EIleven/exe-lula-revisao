
'use client';

import { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import FeedList from '@/components/feed/FeedList';
import CommentCard from '@/components/feed/CommentCard'; // Import CommentCard
import type { User, Post, Comment } from '@/lib/types';
import { getCurrentUser as serverGetCurrentUser } from '@/lib/services/authService';
import { getPostsByUser as serverGetPostsByUser, getUserMediaPosts as serverGetUserMediaPosts } from '@/lib/services/postReadService';
import { getUserComments as serverGetUserComments } from '@/lib/services/comments/commentReadService';
import EditProfileDialog from '@/components/profile/EditProfileDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Edit3 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";


// Component to display a list of comments
const CommentList = ({ comments }: { comments: Comment[] }) => {
  if (!comments || comments.length === 0) {
    return <p className="text-muted-foreground text-center py-4">No comments yet.</p>;
  }
  return (
    <div className="space-y-4">
      {comments.map(comment => (
        // Use the CommentCard component
        <CommentCard key={comment.id} comment={comment} />
      ))}
    </div>
  );
};


export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [userComments, setUserComments] = useState<Comment[]>([]);
  const [userMediaPosts, setUserMediaPosts] = useState<Post[]>([]);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [activeTab, setActiveTab] = useState('posts');

  useEffect(() => {
    async function fetchUser() {
      setIsLoadingUser(true);
      const currentUser = await serverGetCurrentUser();
      if (currentUser) {
        setUser(currentUser);
      }
      setIsLoadingUser(false);
    }
    fetchUser();
  }, []);

  useEffect(() => {
    async function fetchFeedData() {
      if (!user) return;
      setIsLoadingFeed(true);
      switch (activeTab) {
        case 'posts':
          const posts = await serverGetPostsByUser(user.id);
          setUserPosts(posts);
          break;
        case 'comments':
          const comments = await serverGetUserComments(user.id);
          setUserComments(comments);
          break;
        case 'media':
          const mediaPosts = await serverGetUserMediaPosts(user.id);
          setUserMediaPosts(mediaPosts);
          break;
        default:
          break;
      }
      setIsLoadingFeed(false);
    }
    fetchFeedData();
  }, [activeTab, user]);


  const handleProfileUpdated = (updatedUser: User) => {
    setUser(updatedUser);
    if (user) {
        // This is a placeholder for a more complex state update logic
        // For now, refetching data is simplest.
        // fetchFeedData(); // This would cause an infinite loop if not careful
    }
  };


  if (isLoadingUser) {
     return (
      <div className="container mx-auto max-w-3xl py-8 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center space-x-4 pb-4">
            <Skeleton className="h-24 w-24 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="h-10 w-24" />
          </CardHeader>
        </Card>
        <Skeleton className="h-10 w-full" />
        {[...Array(2)].map((_, i) => (
           <div className="w-full max-w-2xl mx-auto p-4 border rounded-lg shadow-sm bg-card" key={i}>
            <div className="flex items-center space-x-3 mb-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4 mb-3" />
            <Skeleton className="aspect-video w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (!user) {
    return <p className="text-center text-muted-foreground">User not found.</p>;
  };

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-8">
      <Card className="overflow-hidden shadow-xl">
        <div className="h-32 bg-gradient-to-r from-primary to-accent" />
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-end -mt-16 sm:space-x-6">
            <Avatar className="h-32 w-32 border-4 border-background ring-2 ring-primary">
              <AvatarImage src={user.avatarUrl} alt={user.name} data-ai-hint="person avatar"/>
              <AvatarFallback className="text-4xl">{user.name.substring(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 mt-4 sm:mt-0 text-center sm:text-left">
              <h1 className="text-3xl font-bold text-foreground">{user.name}</h1>
              <p className="text-muted-foreground">@{user.username}</p>
            </div>
            <EditProfileDialog user={user} onProfileUpdated={handleProfileUpdated}>
              <Button variant="outline">
                <Edit3 className="mr-2 h-4 w-4" /> Edit Profile
              </Button>
            </EditProfileDialog>
          </div>
          {user.bio && <p className="mt-6 text-sm text-foreground text-center sm:text-left">{user.bio}</p>}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
        </TabsList>
        <TabsContent value="posts" className="mt-4">
           <h2 className="text-2xl font-semibold text-foreground mb-6">Your Echoes</h2>
          <FeedList feedContextOptions={{ profileUserId: user.id }} />
        </TabsContent>
        <TabsContent value="comments" className="mt-4">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Your Comments</h2>
          {isLoadingFeed ? (
            <div className="space-y-4">
               {[...Array(3)].map((_, i) => (
                <div key={i} className="border rounded-md p-3 bg-card flex items-start space-x-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                     <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <CommentList comments={userComments} />
          )}
        </TabsContent>
        <TabsContent value="media" className="mt-4">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Your Media</h2>
           {isLoadingFeed ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                 <Skeleton key={i} className="aspect-square rounded-md" />
              ))}
            </div>
           ) : (
            <FeedList feedContextOptions={{ profileUserId: user.id, feedContext: 'profile_media' }} />
           )}

        </TabsContent>
      </Tabs>
    </div>
  );
}
