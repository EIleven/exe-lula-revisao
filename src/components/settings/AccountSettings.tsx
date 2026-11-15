// src/components/settings/AccountSettings.tsx
'use client';

import React, { useState } from 'react';
import type { User } from '@/lib/types';
import { useRouter } from 'next/navigation';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, ChevronRight, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { reauthenticateWithCredential, EmailAuthProvider, deleteUser } from 'firebase/auth';
import { reauthenticateWithGoogleAccount, isGoogleSignInCancelled } from '@/lib/services/googleSignIn';
import { auth } from '@/lib/firebase';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import UpdateEmailDialog from './UpdateEmailDialog';
import UpdatePasswordDialog from './UpdatePasswordDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import UpdateBirthdayDialog from './UpdateBirthdayDialog';
import { getAllUserContentForExport } from '@/lib/services/userService';
import UpdateUsernameDialog from './UpdateUsernameDialog';

interface SettingsProps {
  user: User;
}

export default function AccountSettings({ user }: SettingsProps) {
  const t = useTranslations('AccountSettings');
  const { toast } = useToast();
  const { currentUser, firebaseUser, refreshCurrentUser } = useCurrentUser();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [isUpdateEmailOpen, setIsUpdateEmailOpen] = useState(false);
  const [isUpdatePasswordOpen, setIsUpdatePasswordOpen] = useState(false);
  const [isUpdateBirthdayOpen, setIsUpdateBirthdayOpen] = useState(false);
  const [isUpdateUsernameOpen, setIsUpdateUsernameOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const providerId = firebaseUser?.providerData[0]?.providerId;
  const isGoogleUser = providerId === 'google.com';

  const handleAccountDeletion = async () => {
    if (!currentUser || !auth.currentUser) {
      toast({ title: t('error.noCurrentUser.title'), description: t('error.noCurrentUser.description'), variant: 'destructive' });
      return;
    }
    
    setIsDeleting(true);

    try {
      if (isGoogleUser) {
        await reauthenticateWithGoogleAccount(auth.currentUser);
      } else {
        if (!password) {
          toast({ title: t('error.passwordRequired.title'), description: t('error.passwordRequired.description'), variant: 'destructive' });
          setIsDeleting(false);
          return;
        }
        const credential = EmailAuthProvider.credential(currentUser.email!, password);
        await reauthenticateWithCredential(auth.currentUser, credential);
      }
      
      // Revoga e remove sessoes OAuth antes de apagar o Auth. Se a limpeza
      // local falhar, a exclusao para aqui para nao deixar credencial viva.
      const idToken = await auth.currentUser.getIdToken(true);
      const cleanup = await fetch('/api/account/prepare-deletion', {
        method: 'POST',
        headers: {Authorization: `Bearer ${idToken}`},
      });
      if (!cleanup.ok) {
        const body = await cleanup.json().catch(() => ({}));
        throw new Error(body.message || 'Nao foi possivel preparar a exclusao da conta.');
      }

      // If re-authentication is successful, proceed with deletion
      await deleteUser(auth.currentUser);

      toast({ title: t('deleteSuccess.title'), description: t('deleteSuccess.description') });
      router.push('/'); 
    } catch (error: any) {
      console.error('Account deletion error:', error);
      let description = t('error.unexpected.description');
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        description = t('error.wrongPassword.description');
      } else if (error.code === 'auth/requires-recent-login') {
        description = t('error.recentLogin.description');
      } else if (isGoogleSignInCancelled(error)) {
        description = "A reautenticação foi cancelada.";
      } else if (typeof error?.message === 'string' && error.message.trim()) {
        description = error.message;
      }
      toast({
        title: t('error.deleteFailed.title'),
        description: description,
        variant: 'destructive',
      });
    } finally {
        setPassword('');
        setIsDeleting(false);
        setIsDeleteDialogOpen(false);
    }
  };
  
  const handleExportData = async () => {
    if (!currentUser) return;
    setIsExporting(true);
    try {
      const userData = await getAllUserContentForExport(currentUser.id);
      const jsonString = JSON.stringify(userData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `exe-lula_export_${currentUser.username}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
      toast({
        title: t('export.exportSuccessTitle'),
        description: t('export.exportSuccessDescription'),
      });
    } catch (error: any) {
      toast({
        title: t('export.exportErrorTitle'),
        description: error.message || t('error.unexpected.description'),
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleActionClick = (featureName: string) => {
    toast({
      title: t('notImplemented.title'),
      description: t('notImplemented.description', { feature: featureName }),
    });
  };

  return (
    <>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">{t('mainData.title')}</h3>
             <div className="flex items-center justify-between rounded-lg border p-4">
                <p>{t('mainData.email')}</p>
                <p className="text-muted-foreground">{user.email}</p>
            </div>
             <Dialog open={isUpdateEmailOpen} onOpenChange={setIsUpdateEmailOpen}>
                <button onClick={() => setIsUpdateEmailOpen(true)} className="flex items-center justify-between rounded-lg border p-4 w-full text-left hover:bg-muted/50">
                    <p>{t('mainData.updateEmail')}</p>
                    <ChevronRight className="h-4 w-4 text-muted-foreground"/>
                </button>
                <UpdateEmailDialog user={user} onOpenChange={setIsUpdateEmailOpen} />
             </Dialog>
             <Dialog open={isUpdatePasswordOpen} onOpenChange={setIsUpdatePasswordOpen}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button 
                        onClick={() => !isGoogleUser && setIsUpdatePasswordOpen(true)}
                        className="flex items-center justify-between rounded-lg border p-4 w-full text-left hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isGoogleUser}
                        aria-disabled={isGoogleUser}
                      >
                          <p>{t('mainData.password')}</p>
                          <ChevronRight className="h-4 w-4 text-muted-foreground"/>
                      </button>
                    </TooltipTrigger>
                    {isGoogleUser && (
                      <TooltipContent>
                        <p>{t('mainData.passwordTooltipGoogle')}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                {!isGoogleUser && <UpdatePasswordDialog onOpenChange={setIsUpdatePasswordOpen} />}
             </Dialog>
              <Dialog open={isUpdateUsernameOpen} onOpenChange={setIsUpdateUsernameOpen}>
                <button onClick={() => setIsUpdateUsernameOpen(true)} className="flex items-center justify-between rounded-lg border p-4 w-full text-left hover:bg-muted/50">
                    <p>{t('mainData.updateUsername')}</p>
                    <div className="flex items-center gap-2">
                        <p className="text-muted-foreground">@{user.username}</p>
                        <ChevronRight className="h-4 w-4 text-muted-foreground"/>
                    </div>
                </button>
                <UpdateUsernameDialog user={user} onOpenChange={setIsUpdateUsernameOpen} />
              </Dialog>
             <Dialog open={isUpdateBirthdayOpen} onOpenChange={setIsUpdateBirthdayOpen}>
                <button onClick={() => setIsUpdateBirthdayOpen(true)} className="flex items-center justify-between rounded-lg border p-4 w-full text-left hover:bg-muted/50">
                    <p>{t('mainData.birthday')}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-muted-foreground">{user.dateOfBirth || t('mainData.notSet')}</p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground"/>
                    </div>
                </button>
                <UpdateBirthdayDialog user={user} onOpenChange={setIsUpdateBirthdayOpen} />
             </Dialog>
        </div>

        <Separator />

        <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">{t('export.title')}</h3>
             <button onClick={handleExportData} disabled={isExporting} className="flex items-center justify-between rounded-lg border p-4 w-full text-left hover:bg-muted/50">
                <p>{t('export.exportData')}</p>
                 {isExporting 
                    ? <Loader2 className="h-4 w-4 animate-spin"/> 
                    : <ChevronRight className="h-4 w-4 text-muted-foreground"/>
                 }
            </button>
        </div>
        
        <Separator />
        
        <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t('dangerZone.deleteAccountTitle')}</AlertTitle>
              <AlertDescription>{t('dangerZone.deleteAccountDescription')}</AlertDescription>
            </Alert>
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  {t('dangerZone.deleteAccountButton')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('deleteModal.title')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isGoogleUser ? t('deleteModal.descriptionGoogle') : t('deleteModal.description')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {!isGoogleUser && (
                  <div className="py-2">
                    <Label htmlFor="password-confirm" className="sr-only">{t('deleteModal.passwordLabel')}</Label>
                    <Input
                      id="password-confirm"
                      type="password"
                      placeholder={t('deleteModal.passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setPassword('')}>{t('deleteModal.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleAccountDeletion}
                    disabled={isDeleting || (!isGoogleUser && !password)}
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  >
                    {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isGoogleUser ? t('deleteModal.reauthenticateAndConfirm') : t('deleteModal.confirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </div>
      </CardContent>
    </>
  );
}
