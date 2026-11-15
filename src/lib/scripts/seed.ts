// src/lib/scripts/seed.ts
import { db, auth } from '../firebase'; // Adjusted path
import type { User, Post } from '../types'; // Adjusted path
import {
  collection,
  query,
  getDocs,
  limit as firestoreLimit, // Renamed to avoid conflict if limit is a local variable
  writeBatch,
  doc,
  setDoc,
  Timestamp, // For creating Firestore Timestamps in seed data
  serverTimestamp,
  where
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  updateProfile as updateFirebaseProfile
} from 'firebase/auth';

// These might be needed if your seed data relies on them, or if you call service functions that do.
// For now, assuming direct Firestore operations for seeding simplicity based on original data.ts structure.
// import { ECHO_COMMENT_MAX_LENGTH, NEWS_HEADLINE_MAX_LENGTH, NEWS_BODY_MAX_LENGTH } from '../constants/domain';

const usersCollection = collection(db, 'users');
const postsCollection = collection(db, 'posts');

// --- Data Seeding (Example, run cautiously and ideally once) ---
export const seedInitialData = async (): Promise<void> => {
  try {
    // Check if users collection is empty
    const usersSnap = await getDocs(query(usersCollection, firestoreLimit(1)));
    if (usersSnap.empty) {
      console.log("Users collection is empty. Seeding initial users...");
      // Define a more complete User structure for Firestore, matching your User type
      const initialUsers: Array<Omit<User, 'id' | 'followersCount' | 'followingCount' | 'postsCount' | 'isFollowing' | 'isMuted' | 'isBlocked' | 'hasBlockedCurrentUser'> & {password: string, fixedUid?: string}> = [
        { name: "Alice Wonderland", username: "alice", avatarUrl: "https://placehold.co/100x100.png", "data-ai-hint": "woman portrait", bio: "Curiouser and curiouser.", email:"alice@example.com", dateOfBirth:"1990-01-01", dmPreference: 'everyone', isAdmin: false, password: "password123" },
        { name: "Bob The Builder", username: "bob", avatarUrl: "https://placehold.co/100x100.png", "data-ai-hint": "man portrait", bio: "Can we fix it? Yes, we can!", email:"bob@example.com", dateOfBirth:"1985-05-15", dmPreference: 'followed', isAdmin: false, password: "password123" },
        { name: "Charlie Chaplin", username: "charlie", avatarUrl: "https://placehold.co/100x100.png", "data-ai-hint": "person silhouette", bio: "A day without laughter is a day wasted.", email:"charlie@example.com", dateOfBirth:"1978-11-20", dmPreference: 'none', isAdmin: false, password: "password123" },
        { name: 'Soberan Platform Admin', username: 'soberan', avatarUrl: 'https://placehold.co/100x100.png', "data-ai-hint": "logo brand", bio: 'Overseeing the Soberan network.', email: 'admin@soberan.system', dateOfBirth: '2024-01-01', dmPreference: 'none', isAdmin: true, password: "adminPass123" },
        { name: 'Publicidade', username: 'Publicidade', avatarUrl: 'https://placehold.co/100x100.png', "data-ai-hint": "logo brand", bio: 'Conteúdo patrocinado.', email: 'publicidade@soberan.system', dateOfBirth: '2024-01-01', dmPreference: 'none', isAdmin: false, password: "password123", fixedUid: 'xjc1yPNwYSS3t5hlxqlr0HM9veC3' }
      ];

      const batch = writeBatch(db);
      const seededUserIds: { [username: string]: string } = {};

      for (const userData of initialUsers) {
        const { password, fixedUid, ...userForFirestoreBase } = userData;
        
        let userId = fixedUid;

        // Only create auth user if no fixed UID is provided
        if (!userId) {
            try {
                const userCredential = await createUserWithEmailAndPassword(auth, userData.email, password);
                const firebaseUser = userCredential.user;
                await updateFirebaseProfile(firebaseUser, { displayName: userData.name });
                userId = firebaseUser.uid;
                console.log(`Seeded user ${userData.username} with Auth UID ${userId}`);
            } catch (authError: any) {
                if (authError.code === 'auth/email-already-in-use') {
                    console.log(`User ${userData.email} already exists in Auth. Checking Firestore...`);
                    const q = query(usersCollection, where("email", "==", userData.email));
                    const existingUserSnap = await getDocs(q);
                    if (!existingUserSnap.empty) {
                        const existingUserDoc = existingUserSnap.docs[0];
                        userId = existingUserDoc.id;
                        console.log(`Found existing Firestore user ${userData.username} with ID ${userId}.`);
                    } else {
                        console.warn(`User ${userData.email} in Auth but not found in Firestore. Skipping seed for this user.`);
                        continue; // Skip to next user
                    }
                } else {
                    console.error(`Error creating user ${userData.email} in Auth during seed:`, String(authError));
                    continue; // Skip to next user
                }
            }
        }
        
        if (userId) {
            const userDocRef = doc(usersCollection, userId);
            const finalUserForFirestore: User = {
                ...userForFirestoreBase,
                id: userId,
                followersCount: 0,
                followingCount: 0,
                postsCount: 0,
            };
            batch.set(userDocRef, finalUserForFirestore);
            seededUserIds[finalUserForFirestore.username] = userId;
        }
      }
      await batch.commit();
      console.log("Initial users seeded into Firestore and Auth where applicable.");

      // Seed posts only if users were successfully seeded/retrieved
      if (Object.keys(seededUserIds).length > 0) {
        const postsSnap = await getDocs(query(postsCollection, firestoreLimit(1)));
        if (postsSnap.empty) {
            console.log("Posts collection is empty. Seeding initial posts...");
            
            const user1Id = seededUserIds['alice'] || 'mockUser1_fallback';
            const user2Id = seededUserIds['bob'] || 'mockUser2_fallback';
            const user3Id = seededUserIds['charlie'] || 'mockUser3_fallback';

            const initialPostsData = [
                { userId: user1Id, type: 'original', text: "Just had a wonderful tea party with @bob! ☕ Excited to see what @charlie is up to. Exploring #WebDevelopment and new #AI trends. #Wonderland #TeaTime Check out this video: https://www.youtube.com/watch?v=dQw4w9WgXcQ", category: 'echo', allowReposts: true, replyPermission: 'everyone', createdAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 60 * 24 * 2)) },
                { userId: user2Id, type: 'original', text: "Working on a new #NextJS project. It's going to be BIG! 🛠️ Maybe @alice can help. #Building #Projects #WebDevelopment", category: 'echo', allowReposts: true, replyPermission: 'followed', createdAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 60 * 10)) },
                { userId: user3Id, type: 'original', text: "Thinking about my next film. Silence can be powerful. What do you think, @alice and @bob? 🎬 #SilentFilm #ClassicCinema #Filmmaking", category: 'echo', allowReposts: false, replyPermission: 'mentioned', youtubeVideoId: '6L6XqWoS8tw', postFormat: 'short_video', createdAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 60 * 5)) },
                { userId: user1Id, type: 'original', category: 'news', headline: "Groundbreaking AI Discovers New Particle!", text: "Scientists at the forefront of #AI research announced today the discovery of a new subatomic particle... @bob, check this out! #Science #Physics", imageUrl: "https://placehold.co/600x400.png", "data-ai-hint": "abstract science", sourceUrl: "https://example.com/news/ai-particle", newsCategory: "Science", allowReposts: true, replyPermission: 'everyone', views: 1200, createdAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 60 * 3)) },
            ];
            const postBatch = writeBatch(db);
            initialPostsData.forEach(postData => {
                const postDocRef = doc(collection(db, 'posts')); // Auto-generate ID
                const finalPostData = {
                    ...postData,
                    likes: Math.floor(Math.random() * 100),
                    reposts: Math.floor(Math.random() * 50),
                    commentsCount: 0,
                    isLikedBy: {},
                    isEdited: false,
                    editCount: 0,
                    views: postData.views || Math.floor(Math.random() * 1000),
                    postFormat: postData.postFormat || 'standard',
                    // Ensure all nullable fields are present or explicitly null if not provided
                    text: postData.text || null,
                    imageUrl: postData.imageUrl || null,
                    'data-ai-hint': postData["data-ai-hint"] || null,
                    youtubeVideoId: postData.youtubeVideoId || null,
                    headline: postData.headline || null,
                    sourceUrl: postData.sourceUrl || null,
                    newsCategory: postData.newsCategory || null,
                };
                postBatch.set(postDocRef, finalPostData);
            });
            await postBatch.commit();
            console.log("Initial posts seeded.");
        } else {
          // console.log("Posts collection already has data, skipping post seeding.");
        }
      }
    } else {
      // console.log("Users collection already has data, skipping user seeding.");
    }
  } catch (error: any) {
    console.error("Error during initial data seeding check/process:", String(error));
  }
};

// IIFE to run seeding logic once on module load if collections are empty
// This is primarily for development convenience.
// In production, you'd use a more controlled seeding mechanism or migrations.
(async () => {
    // Check for a specific environment variable or build mode flag to run seed.
    // Avoid running automatically in all development environments without explicit control.
    // Example: if (process.env.NODE_ENV === 'development' && process.env.RUN_SEED === 'true') {
    if (process.env.NODE_ENV === 'development') { // Or a more specific flag
        console.log("Checking if initial data seeding is required for development...");
        // await seedInitialData(); // Uncomment or use a flag to run automatically during development
    }
})();
