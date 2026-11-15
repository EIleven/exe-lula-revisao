// src/lib/services/fileService.ts
import { db } from '@/lib/firebase';
import type { User } from '@/lib/types';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
  writeBatch,
  getDoc,
  updateDoc,
  type WriteBatch,
} from 'firebase/firestore';
import { uploadFileToStorage, userFilesPathFactory, deleteFileFromStorage } from './mediaUploadService';
import { tombstoneMediaDoc } from './mediaVisibility';
import type { Timestamp } from 'firebase/firestore';

export interface FileItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  userId: string;
  parentId: string | null;
  storagePath?: string;
  /** Id em media/{id}; permite marcar tombstone ao apagar. */
  mediaId?: string | null;
  url?: string;
  size?: number;
  contentType?: string;
  createdAt: Timestamp;
}

const userFilesCollection = collection(db, 'userFiles');

export const getFiles = async (userId: string, parentId: string | null = null): Promise<FileItem[]> => {
  if (!userId) return [];
  
  const q = query(
    userFilesCollection,
    where('userId', '==', userId),
    where('parentId', '==', parentId),
    orderBy('type', 'desc'), // folders first
    orderBy('name', 'asc')
  );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileItem));
};

export const createFolder = async (userId: string, parentId: string | null, folderName: string): Promise<FileItem> => {
  if (!userId || !folderName.trim()) {
    throw new Error('User ID and folder name are required.');
  }

  const newFolder: Omit<FileItem, 'id' | 'createdAt'> & { createdAt: any } = {
    name: folderName.trim(),
    type: 'folder',
    userId,
    parentId,
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(userFilesCollection, newFolder);
  return { id: docRef.id, ...newFolder, createdAt: new Date() as any };
};

export const uploadAndRegisterFile = async (userId: string, parentId: string | null, file: File): Promise<FileItem> => {
    if (!userId || !file) {
        throw new Error('User ID and file are required.');
    }

    // 1. Upload the file to Storage
    const { downloadURL, filePath, mediaId } = await uploadFileToStorage(userId, file, userFilesPathFactory);

    // 2. Create the file metadata document in Firestore
    const newFile: Omit<FileItem, 'id' | 'createdAt'> & { createdAt: any } = {
        name: file.name,
        type: 'file',
        userId,
        parentId,
        storagePath: filePath,
        // `/mp/<id>`: rota autenticada, sem token. Guardar o mediaId permite marcar
        // tombstone e revogar o token ao apagar o arquivo.
        url: downloadURL,
        mediaId: mediaId ?? null,
        size: file.size,
        contentType: file.type,
        createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(userFilesCollection, newFile);
    return { id: docRef.id, ...newFile, createdAt: new Date() as any };
};

export const getFolderPath = async (folderId: string | null): Promise<{id: string, name: string}[]> => {
    if (!folderId) return [];
    let currentId: string | null = folderId;
    const path = [];

    while (currentId) {
        const folderRef = doc(userFilesCollection, currentId);
        const folderSnap = await getDoc(folderRef);
        if (folderSnap.exists()) {
            const data = folderSnap.data() as FileItem;
            path.unshift({ id: folderSnap.id, name: data.name });
            currentId = data.parentId;
        } else {
            currentId = null; // Stop if a parent is not found
        }
    }
    return path;
};

export const renameFileOrFolder = async (itemId: string, newName: string): Promise<void> => {
    if (!itemId || !newName.trim()) {
        throw new Error('Item ID and new name are required.');
    }
    const itemRef = doc(userFilesCollection, itemId);
    await updateDoc(itemRef, {
        name: newName.trim(),
        updatedAt: serverTimestamp(),
    });
};

const deleteFolderRecursively = async (userId: string, folderId: string, batch: WriteBatch) => {
    const q = query(userFilesCollection, where('userId', '==', userId), where('parentId', '==', folderId));
    const snapshot = await getDocs(q);

    for (const docSnap of snapshot.docs) {
        const item = { id: docSnap.id, ...docSnap.data() } as FileItem;
        if (item.type === 'folder') {
            await deleteFolderRecursively(userId, item.id, batch);
        } else {
            if (item.storagePath) {
                try {
                    await deleteFileFromStorage(item.storagePath);
                } catch (error) {
                    console.error(`Failed to delete file from storage: ${item.storagePath}`, error);
                }
            }
            // O objeto saiu do Storage, então não há token a revogar. O tombstone evita deixar
            // registro órfão apontando para um objeto que não existe mais.
            await tombstoneMediaDoc(item.mediaId);
            batch.delete(doc(userFilesCollection, item.id));
        }
    }
    
    batch.delete(doc(userFilesCollection, folderId));
};

export const deleteFileOrFolder = async (item: FileItem, userId: string): Promise<void> => {
    if (!item || !item.id || !userId) {
        throw new Error('Item to delete is invalid or user is not specified.');
    }
    if (item.userId !== userId) {
        throw new Error('User is not authorized to delete this item.');
    }

    if (item.type === 'file') {
        if (item.storagePath) {
            await deleteFileFromStorage(item.storagePath).catch(err => {
              console.error(`Failed to delete file from storage: ${item.storagePath}`, err);
            });
        }
        await tombstoneMediaDoc(item.mediaId);
        await deleteDoc(doc(userFilesCollection, item.id));
    } else if (item.type === 'folder') {
        const batch = writeBatch(db);
        await deleteFolderRecursively(userId, item.id, batch);
        await batch.commit();
    }
};