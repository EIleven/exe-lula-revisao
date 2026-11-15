
'use client';

import React, { useState, useEffect, useRef, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/lib/types';
import { updateUserSettings as serverUpdateUserProfile } from '@/lib/services/userService';
import Image from 'next/image';
import { Camera, UploadCloud, XCircle, Loader2, Link as LinkIcon, MapPin, Plus, Trash2, QrCode, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { UserProfileUpdatePayload } from '@/lib/services/userService';
import { uploadFileToStorage, deleteFileFromStorage, avatarPathFactory, coverPathFactory, UploadResult } from '@/lib/services/mediaUploadService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { mediaIdFromUrl } from '@/lib/media/mediaId';
import { caminhoDaUrlAntiga } from '@/lib/media/legacyUrl';
import { tombstoneMediaDoc } from '@/lib/services/mediaVisibility';
import {
  classifyDeletionOutcome,
  shouldTombstone,
  worthRetrying,
  type DeletionOutcome,
  type ReplacementOutcome,
} from '@/lib/media/mediaReplacement';
import ImageCropper from '@/components/shared/ImageCropper';
import { getCroppedImg } from '@/lib/utils/imageUtils';
import { useTranslations } from 'next-intl';

// Schema for form validation using Zod
const profileFormSchema = z.object({
  name: z.string()
    .min(2, { message: "Name must be at least 2 characters." })
    .max(50, { message: "Name cannot exceed 50 characters." }),
  bio: z.string()
    .max(300, "Bio cannot exceed 300 characters.")
    .optional().or(z.literal('')),
  pronouns: z.string()
    .max(30, "Pronomes podem ter no máximo 30 caracteres.")
    .optional().or(z.literal('')),
  location: z.string()
    .max(30, "Location cannot exceed 30 characters.")
    .optional().or(z.literal('')),
  website: z.string()
    .max(100, "Website URL cannot exceed 100 characters.")
    .refine((val) => !val || z.string().url().safeParse(val).success, {
      message: "Please enter a valid URL (e.g., https://example.com).",
    })
    .optional().or(z.literal('')),
  pixKey: z.string()
    .max(140, "Chave Pix muito longa.")
    .optional().or(z.literal('')),
  pixCity: z.string()
    .max(30, "Cidade pode ter no máximo 30 caracteres.")
    .optional().or(z.literal('')),
  pixDescription: z.string()
    .max(80, "Mensagem de apoio pode ter no máximo 80 caracteres.")
    .optional().or(z.literal('')),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

interface EditProfileDialogProps {
  user: User;
  onProfileUpdated: (updatedUser: Partial<User>) => void;
  children: ReactNode;
}

/**
 * Caminho do objeto que o avatar (ou a capa) atual usa, para apagá-lo ao trocar de foto.
 *
 * Isto existia parseando a URL do Firebase, e QUEBRA em silêncio na mídia migrada: `media.exercitodolula.app/m/<id>`
 * não tem `/o/<caminho>`, então o caminho vinha `null`, `deleteFileFromStorage` nunca era chamado e cada troca de
 * foto deixava o objeto anterior no bucket — órfão novo, para sempre, sem nenhum erro aparecendo.
 *
 * Agora resolve as duas formas:
 * - **URL própria**: o caminho está em `media/{id}`, que a regra do Firestore deixa o próprio dono ler.
 * - **URL antiga**: `caminhoDaUrlAntiga`, a mesma função que a migração usa. Ela compara o hostname EXATO; o parser
 *   que estava aqui usava `includes`, e `firebasestorage.googleapis.com.site-falso.test` passaria por nosso host.
 *
 * Devolve também o `mediaId`, porque apagar o objeto sem marcar o registro deixaria um registro apontando para o
 * vazio — o inventário chama isso de `objeto-ausente-sem-tombstone`.
 */
const resolverMidiaAtual = async (
  url: string | null | undefined,
): Promise<{ caminho: string | null; mediaId: string | null }> => {
  if (!url) return { caminho: null, mediaId: null };

  const propria = mediaIdFromUrl(url);
  if (propria) {
    try {
      const registro = await getDoc(doc(db, 'media', propria.id));
      const caminho = registro.exists() ? (registro.data()?.storagePath as string | undefined) : undefined;
      return { caminho: caminho ?? null, mediaId: propria.id };
    } catch {
      // Sem o registro não há caminho, e apagar às cegas seria pior: deixa o objeto e marca o registro.
      return { caminho: null, mediaId: propria.id };
    }
  }

  return { caminho: caminhoDaUrlAntiga(url), mediaId: null };
};

/**
 * Apaga o objeto da mídia substituída e, SÓ com certeza de ausência, marca o registro.
 *
 * Tenta duas vezes quando a falha é do tipo que costuma ser passageira. Se ainda falhar, devolve `'falhou'`: o
 * registro fica **ativo**, o objeto fica no bucket, e é justamente isso que permite tentar de novo — um registro
 * ativo apontando para um objeto que existe é a única coisa que a reconciliação consegue achar depois. Marcar o
 * tombstone aqui esconderia o objeto para sempre.
 */
const removerMidiaAnterior = async (
  anterior: { caminho: string | null; mediaId: string | null },
): Promise<ReplacementOutcome> => {
  if (!anterior.caminho) {
    // Sem caminho não há o que excluir. Se havia registro, ele não descreve objeto algum que saibamos localizar;
    // deixá-lo ativo é o mais honesto, e o inventário o reporta.
    return anterior.mediaId ? 'falhou' : 'excluido';
  }

  let desfecho: DeletionOutcome = 'falhou';
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      await deleteFileFromStorage(anterior.caminho);
      desfecho = 'excluido';
      break;
    } catch (erro) {
      desfecho = classifyDeletionOutcome(erro);
      if (desfecho !== 'falhou' || !worthRetrying(erro)) break;
      console.warn(`Exclusão da mídia anterior falhou (tentativa ${tentativa + 1}):`, erro);
    }
  }

  if (anterior.mediaId && shouldTombstone(desfecho)) {
    try {
      await tombstoneMediaDoc(anterior.mediaId);
    } catch (erro) {
      // O perfil já foi salvo. Propagar esta falha até o `catch` externo faria o rollback apagar a imagem NOVA que
      // o perfil acabou de adotar. O inventário detecta este registro ainda ativo apontando para objeto ausente.
      console.error('Objeto anterior excluído, mas o tombstone ficou pendente:', erro);
      return 'registro-pendente';
    }
  }
  return desfecho;
};

export default function EditProfileDialog({ user, onProfileUpdated, children }: EditProfileDialogProps) {
  const t = useTranslations('EditProfileDialog');
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [avatarToCrop, setAvatarToCrop] = useState<string | null>(null);
  const [coverToCrop, setCoverToCrop] = useState<string | null>(null);
  const [croppedAvatarFile, setCroppedAvatarFile] = useState<File | null>(null);
  const [croppedCoverFile, setCroppedCoverFile] = useState<File | null>(null);
  
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(user.avatarUrl || null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(user.coverImageUrl || null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [coverRemoved, setCoverRemoved] = useState(false);

  const [isAvatarCameraOpen, setIsAvatarCameraOpen] = useState(false);
  const [hasAvatarCameraPermission, setHasAvatarCameraPermission] = useState<boolean | null>(null);
  const [isAvatarCapturing, setIsAvatarCapturing] = useState(false);
  
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const avatarVideoRef = useRef<HTMLVideoElement>(null);

  const { toast } = useToast();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: user.name || '',
      bio: user.bio || '',
      pronouns: user.pronouns || '',
      location: user.location || '',
      website: user.website || '',
      pixKey: user.pixKey || '',
      pixCity: user.pixCity || '',
      pixDescription: user.pixDescription || '',
    },
    mode: 'onChange',
  });

  const [extraLinks, setExtraLinks] = useState<Array<{ label: string; url: string }>>(() =>
    (user.links ?? []).map((l) => ({ label: l.label || '', url: l.url || '' })),
  );

  const normalizedExtraLinks = extraLinks
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.url.length > 0);
  const initialLinks = (user.links ?? [])
    .map((l) => ({ label: (l.label || '').trim(), url: (l.url || '').trim() }))
    .filter((l) => l.url.length > 0);
  const hasLinksChanged = JSON.stringify(normalizedExtraLinks) !== JSON.stringify(initialLinks);

  const { formState: { isDirty } } = form;
  const hasImageChanged = !!croppedAvatarFile || !!croppedCoverFile || avatarRemoved || coverRemoved;
  const canSubmit = isDirty || hasImageChanged || hasLinksChanged;

  // Preenche o formulário só ao ABRIR o diálogo. Antes valia a cada novo objeto `user`, que a página do perfil troca a
  // cada atualização em segundo plano: o formulário era zerado no meio da edição e o que a pessoa já tinha digitado
  // (ou a foto escolhida) se perdia, e só o que veio depois era salvo.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (justOpened) {
      form.reset({
        name: user.name || '',
        bio: user.bio || '',
        pronouns: user.pronouns || '',
        location: user.location || '',
        website: user.website || '',
        pixKey: user.pixKey || '',
        pixCity: user.pixCity || '',
        pixDescription: user.pixDescription || '',
      });
      setExtraLinks((user.links ?? []).map((l) => ({ label: l.label || '', url: l.url || '' })));
      setAvatarPreviewUrl(user.avatarUrl || null);
      setCoverPreviewUrl(user.coverImageUrl || null);
      setCroppedAvatarFile(null);
      setCroppedCoverFile(null);
      setAvatarRemoved(false);
      setCoverRemoved(false);
      setIsLoading(false);
      setUploadProgress(null);
      setIsAvatarCameraOpen(false);
      setAvatarToCrop(null);
      setCoverToCrop(null);
    }
  }, [open, user, form]);

  const handleImageFileSelect = (event: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { 
      toast({ title: t('fileTooLargeTitle'), description: t('fileTooLargeDescription'), variant: "destructive" });
      if (event.target) event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUri = reader.result as string;
      if (type === 'avatar') {
        setAvatarToCrop(dataUri); 
        setIsAvatarCameraOpen(false);
      } else {
        setCoverToCrop(dataUri);
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    const getCameraPermission = async () => {
      if (!isAvatarCameraOpen) {
        if (avatarVideoRef.current && avatarVideoRef.current.srcObject) {
            (avatarVideoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
            avatarVideoRef.current.srcObject = null;
        }
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setHasAvatarCameraPermission(true);
        if (avatarVideoRef.current) {
          avatarVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        setHasAvatarCameraPermission(false);
        setIsAvatarCameraOpen(false);
      }
    };

    getCameraPermission();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isAvatarCameraOpen]);


  const handleAvatarCapture = () => {
    if (avatarVideoRef.current && hasAvatarCameraPermission) {
      setIsAvatarCapturing(true);
      const video = avatarVideoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL('image/jpeg', 0.9);
      setAvatarToCrop(dataUri); 
      setIsAvatarCameraOpen(false);
      setIsAvatarCapturing(false);
    }
  };

  const handleAvatarCropComplete = async (croppedImageBlob: Blob) => {
    const croppedFile = new File([croppedImageBlob], "avatar.jpg", { type: "image/jpeg" });
    setCroppedAvatarFile(croppedFile);
    setAvatarPreviewUrl(URL.createObjectURL(croppedImageBlob));
    setAvatarToCrop(null); 
    setAvatarRemoved(false);
  };

  const handleCoverCropComplete = async (croppedImageBlob: Blob) => {
    const croppedFile = new File([croppedImageBlob], "cover.jpg", { type: "image/jpeg" });
    setCroppedCoverFile(croppedFile);
    setCoverPreviewUrl(URL.createObjectURL(croppedImageBlob));
    setCoverToCrop(null);
    setCoverRemoved(false);
  };

  const removeImagePreview = (type: 'avatar' | 'cover') => {
    if (type === 'avatar') {
      setAvatarPreviewUrl(null);
      setCroppedAvatarFile(null);
      setAvatarRemoved(true);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
    } else {
      setCoverPreviewUrl(null);
      setCroppedCoverFile(null);
      setCoverRemoved(true);
      if (coverFileInputRef.current) coverFileInputRef.current.value = '';
    }
  };

  async function onSubmit(data: ProfileFormValues) {
    if (!canSubmit) {
      toast({ title: t('noChangesTitle'), description: t('noChangesDescription') });
      setOpen(false);
      return;
    }

    setIsLoading(true);
    setUploadProgress(0);
    
    const updatePayload: UserProfileUpdatePayload = {};
    let newAvatarFirebaseResult: UploadResult | null = null;
    let newCoverFirebaseResult: UploadResult | null = null;
    /**
     * Mídia substituída: caminho do objeto e registro correspondente. O tombstone de cada uma depende do desfecho
     * REAL da exclusão, nunca de ter tentado — ver `mediaReplacement.ts`.
     */
    const midiasSubstituidas: { caminho: string | null; mediaId: string | null }[] = [];

    try {
      if (croppedAvatarFile || avatarRemoved) {
        const anterior = await resolverMidiaAtual(user.avatarUrl);
        if (anterior.caminho) updatePayload.oldAvatarPath = anterior.caminho;
        if (anterior.caminho || anterior.mediaId) midiasSubstituidas.push(anterior);
      }
      if (croppedAvatarFile) {
        newAvatarFirebaseResult = await uploadFileToStorage(user.id, croppedAvatarFile, avatarPathFactory, (p) => setUploadProgress(p * 0.5));
        updatePayload.avatarUrl = newAvatarFirebaseResult.downloadURL;
        updatePayload["data-ai-hint"] = "person avatar";
      } else if (avatarRemoved) {
        updatePayload.avatarUrl = null;
        updatePayload["data-ai-hint"] = null;
      }

      if (croppedCoverFile || coverRemoved) {
        const anterior = await resolverMidiaAtual(user.coverImageUrl);
        if (anterior.caminho) updatePayload.oldCoverPath = anterior.caminho;
        if (anterior.caminho || anterior.mediaId) midiasSubstituidas.push(anterior);
      }
      if (croppedCoverFile) {
        newCoverFirebaseResult = await uploadFileToStorage(user.id, croppedCoverFile, coverPathFactory, (p) => setUploadProgress(50 + p * 0.5));
        updatePayload.coverImageUrl = newCoverFirebaseResult.downloadURL;
        updatePayload["cover-image-ai-hint"] = "profile cover image";
      } else if (coverRemoved) {
        updatePayload.coverImageUrl = null;
        updatePayload["cover-image-ai-hint"] = null;
      }

      if (isDirty) {
        if (data.name !== user.name) updatePayload.name = data.name;
        if (data.bio !== (user.bio || '')) updatePayload.bio = data.bio;
        if ((data.pronouns || '') !== (user.pronouns || '')) updatePayload.pronouns = data.pronouns || '';
        if (data.location !== (user.location || '')) updatePayload.location = data.location;
        if (data.website !== (user.website || '')) updatePayload.website = data.website;
        if ((data.pixKey || '') !== (user.pixKey || '')) updatePayload.pixKey = (data.pixKey || '').trim();
        if ((data.pixCity || '') !== (user.pixCity || '')) updatePayload.pixCity = (data.pixCity || '').trim();
        if ((data.pixDescription || '') !== (user.pixDescription || '')) updatePayload.pixDescription = (data.pixDescription || '').trim();
      }
      if (hasLinksChanged) {
        updatePayload.links = normalizedExtraLinks.map((l) => ({
          ...(l.label ? { label: l.label } : {}),
          url: l.url.startsWith('http://') || l.url.startsWith('https://') ? l.url : `https://${l.url}`,
        }));
      }
      
      if (Object.keys(updatePayload).length > 0) {
        const updatedUser = await serverUpdateUserProfile(user.id, updatePayload);
        
        // Exclusão do objeto anterior e, SÓ com certeza de ausência, o tombstone do registro. A ordem importa:
        // com o objeto já fora, não há token para revogar, e `tombstoneMediaDoc` (que escreve direto, pela regra
        // do dono) basta. Gravar o tombstone sem a exclusão confirmada seria afirmar no banco algo falso — e isso
        // é pior que o vazamento, porque esconderia o objeto da reconciliação: o registro marcado não é mais
        // olhado por ninguém, e o objeto segue no bucket servindo pela URL antiga.
        const pendentes = (await Promise.all(midiasSubstituidas.map(removerMidiaAnterior)))
          .filter((desfecho) => desfecho === 'falhou' || desfecho === 'registro-pendente').length;
        if (pendentes > 0) {
          toast({
            variant: 'destructive',
            title: t('replacementCleanupTitle'),
            description: t('replacementCleanupDescription', { count: pendentes }),
          });
        } else {
          toast({ title: t('updateSuccessTitle'), description: t('updateSuccessDescription') });
        }
        onProfileUpdated(updatedUser);
        setOpen(false);
      } else {
        toast({ title: t('noChangesTitle'), description: t('noChangesDescription') });
        setOpen(false);
      }

    } catch (error: any) {
      console.error("Error updating profile:", error);
      toast({ title: t('updateFailedTitle'), description: error.message || t('updateFailedDescription'), variant: 'destructive' });
      
      if (newAvatarFirebaseResult?.filePath) await deleteFileFromStorage(newAvatarFirebaseResult.filePath).catch(e => console.warn("Cleanup of new avatar failed:", e));
      if (newCoverFirebaseResult?.filePath) await deleteFileFromStorage(newCoverFirebaseResult.filePath).catch(e => console.warn("Cleanup of new cover failed:", e));
    } finally {
      setIsLoading(false);
      setUploadProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        {avatarToCrop && (
          <ImageCropper
            imageSrc={avatarToCrop}
            onCropComplete={handleAvatarCropComplete}
            onCancel={() => setAvatarToCrop(null)}
            aspectRatio={1}
            cropShape="round"
            title={t('cropperTitle')}
            description={t('cropperDescription')}
            cancelLabel={t('cancel')}
            applyLabel={t('applyCrop')}
          />
        )}

        {coverToCrop && (
            <ImageCropper
                imageSrc={coverToCrop}
                onCropComplete={handleCoverCropComplete}
                onCancel={() => setCoverToCrop(null)}
                aspectRatio={3 / 1}
                cropShape="rect"
                title={t('cropperTitle')}
                description={t('cropperDescription')}
                cancelLabel={t('cancel')}
                applyLabel={t('applyCrop')}
            />
        )}
        
        {!avatarToCrop && !coverToCrop && (
          <>
            {isLoading && uploadProgress !== null && (
              <div className="w-full my-2 px-6">
                <div className="text-sm text-muted-foreground mb-1 text-center">{t('uploading')}: {Math.round(uploadProgress)}%</div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full transition-all duration-150" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              </div>
            )}
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 px-6 pb-6">
                <FormItem>
                  <FormLabel>{t('coverImageLabel')}</FormLabel>
                  <div className="mt-2 aspect-[3/1] w-full rounded-lg border border-dashed border-border overflow-hidden relative bg-muted flex items-center justify-center">
                    {coverPreviewUrl ? (
                      <Image src={coverPreviewUrl} alt="Cover image preview" fill className="object-cover" />
                    ) : (
                      <div className="text-center text-muted-foreground p-4">
                        <UploadCloud className="mx-auto h-8 w-8" />
                        <p className="mt-2 text-sm">{t('uploadCoverImage')}</p>
                      </div>
                    )}
                    <div className="absolute top-2 right-2 flex space-x-2">
                      <Button type="button" size="icon" variant="secondary" onClick={() => coverFileInputRef.current?.click()}>
                        <UploadCloud className="h-5 w-5" />
                      </Button>
                      {coverPreviewUrl && (
                        <Button type="button" size="icon" variant="destructive" onClick={() => removeImagePreview('cover')}>
                          <XCircle className="h-5 w-5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <input type="file" accept="image/*" ref={coverFileInputRef} onChange={(e) => handleImageFileSelect(e, 'cover')} className="hidden" />
                </FormItem>

                <div className="flex flex-col sm:flex-row sm:items-start sm:space-x-4">
                  <FormItem className="-mt-12 sm:-mt-16 z-10">
                    <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-background overflow-hidden relative group bg-muted">
                      {avatarPreviewUrl ? (
                        <Image src={avatarPreviewUrl} alt="Avatar preview" fill className="object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Camera className="w-8 h-8" /></div>
                      )}
                      <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button type="button" size="icon" variant="outline" className="mr-1" onClick={() => avatarFileInputRef.current?.click()}>
                          <UploadCloud className="h-5 w-5" />
                        </Button>
                        <Button type="button" size="icon" variant="outline" onClick={() => setIsAvatarCameraOpen(true)}>
                          <Camera className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                    {avatarPreviewUrl && (
                      <Button type="button" variant="link" size="sm" onClick={() => removeImagePreview('avatar')} className="text-destructive hover:text-destructive-foreground mt-1">
                        {t('remove')}
                      </Button>
                    )}
                    <input type="file" accept="image/*" ref={avatarFileInputRef} onChange={(e) => handleImageFileSelect(e, 'avatar')} className="hidden" />
                  </FormItem>
                  
                  <div className="w-full space-y-4 mt-4 sm:mt-0">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('nameLabel')}</FormLabel>
                        <FormControl><Input placeholder={t('namePlaceholder')} {...field} className="border-primary/50" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
                
                {isAvatarCameraOpen && (
                  <div className="space-y-2 p-2 border rounded-md bg-muted/10">
                    <video ref={avatarVideoRef} className="w-full aspect-video rounded-md bg-black" autoPlay playsInline muted />
                    {hasAvatarCameraPermission === false && <Alert variant="destructive"><AlertTitle>{t('cameraAccessDenied')}</AlertTitle></Alert>}
                    <div className="flex space-x-2 mt-2">
                      <Button type="button" onClick={handleAvatarCapture} disabled={!hasAvatarCameraPermission || isAvatarCapturing} className="flex-1">
                        {isAvatarCapturing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />} {t('capture')}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setIsAvatarCameraOpen(false)}>{t('cancel')}</Button>
                    </div>
                  </div>
                )}
                
                <FormField control={form.control} name="bio" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('bioLabel')}</FormLabel>
                    <FormControl><Textarea placeholder={t('bioPlaceholder')} {...field} value={field.value ?? ''} className="border-primary/50" maxLength={300} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="pronouns" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pronomes</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: ele/dele, ela/dela, elu/delu" {...field} value={field.value ?? ''} className="border-primary/50" />
                    </FormControl>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {['ele/dele', 'ela/dela', 'elu/delu', 'qualquer pronome'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => form.setValue('pronouns', preset, { shouldDirty: true, shouldValidate: true })}
                          className="rounded-full border border-border/70 bg-secondary/40 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="location" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('locationLabel')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder={t('locationPlaceholder')} {...field} value={field.value ?? ''} className="pl-9 border-primary/50" />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="website" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('websiteLabel')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder={t('websitePlaceholder')} {...field} value={field.value ?? ''} className="pl-9 border-primary/50" />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Sites e links extras */}
                <div className="space-y-2.5 rounded-xl border border-border/70 bg-secondary/15 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Outros sites e links</span>
                    {extraLinks.length < 3 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full text-xs"
                        onClick={() => setExtraLinks((prev) => [...prev, { label: '', url: '' }])}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Adicionar link
                      </Button>
                    )}
                  </div>
                  {extraLinks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Adicione até 3 links extras (YouTube, canal, portfólio, loja...).
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {extraLinks.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            placeholder="Nome (ex: YouTube)"
                            value={item.label}
                            maxLength={24}
                            onChange={(e) => {
                              const next = [...extraLinks];
                              next[idx] = { ...next[idx], label: e.target.value };
                              setExtraLinks(next);
                            }}
                            className="w-1/3 h-9 text-xs border-primary/40"
                          />
                          <Input
                            placeholder="https://..."
                            value={item.url}
                            maxLength={140}
                            onChange={(e) => {
                              const next = [...extraLinks];
                              next[idx] = { ...next[idx], url: e.target.value };
                              setExtraLinks(next);
                            }}
                            className="flex-1 h-9 text-xs border-primary/40"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setExtraLinks((prev) => prev.filter((_, i) => i !== idx))}
                            aria-label="Remover link"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Badge Pix de apoio */}
                <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-semibold">Badge Pix na Bio</span>
                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Exibe um selo moderno de Pix no seu perfil com QR Code automático, Copia e Cola e lembrete mensal opcional.
                  </p>
                  <FormField control={form.control} name="pixKey" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Chave Pix</FormLabel>
                      <FormControl>
                        <Input placeholder="CPF/CNPJ, e-mail, +55DDD..., ou chave aleatória" {...field} value={field.value ?? ''} className="h-9 text-sm border-emerald-500/40" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <FormField control={form.control} name="pixCity" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Cidade (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Brasília" {...field} value={field.value ?? ''} className="h-9 text-sm border-emerald-500/30" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="pixDescription" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Mensagem de apoio (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Apoie meu trabalho" {...field} value={field.value ?? ''} className="h-9 text-sm border-emerald-500/30" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                <DialogFooter className="pt-4">
                  <DialogClose asChild>
                    <Button type="button" variant="outline" disabled={isLoading}>{t('cancel')}</Button>
                  </DialogClose>
                  <Button type="submit" disabled={isLoading || !canSubmit}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t('save')}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
