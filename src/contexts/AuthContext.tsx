
'use client';

import type { User as AppUserType } from '@/lib/types';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthUserChanged } from '@/lib/services/authService';
import type { User as FirebaseUser } from 'firebase/auth'; 
import { syncServerSession } from '@/lib/services/serverSession';
import { auth } from '@/lib/firebase';

interface AuthContextType {
  currentUser: AppUserType | null; 
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  refreshCurrentUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AppUserType | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthUserChanged((user) => {
      setCurrentUser(user);
      setFirebaseUser(auth.currentUser); 
      setIsLoading(false);
      // Mantém o cookie `__session` alinhado: é o que permite a mídia privada carregar em <img>, <video> e
      // download, que não mandam cabeçalho Authorization. Não bloqueia a interface.
      void syncServerSession();
    });

    return () => unsubscribe();
  }, []); 

  const refreshCurrentUser = useCallback(() => {
    setIsLoading(true);
    const unsubscribe = onAuthUserChanged((user) => {
      setCurrentUser(user);
      setFirebaseUser(auth.currentUser);
      setIsLoading(false);
      unsubscribe();
    });
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, firebaseUser, isLoading, refreshCurrentUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
