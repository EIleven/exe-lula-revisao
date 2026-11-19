
// src/app/[locale]/files/page.tsx
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Folder as FolderIcon,
  File as FileIcon,
  Upload,
  FolderPlus,
  Home,
  ChevronRight,
  Loader2,
  FileX2,
  LogIn,
  UploadCloud,
  MoreHorizontal,
  Download,
  Share2,
  Edit,
  Trash2,
  Lock,
  ShieldCheck,
  SlidersHorizontal,
  KeyRound,
  Copy,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  getP2pPreferences,
  saveP2pPreferences,
  DEFAULT_P2P_PREFERENCES,
  type P2pPreferences,
} from '@/lib/p2p/p2pPreferences';
import {
  decryptFileBytes,
  DEFAULT_FILE_VAULT_SETTINGS,
  encryptFileForUpload,
  exportLocalFileSecret,
  getFileVaultSettings,
  importLocalFileSecret,
  isEncryptedFileName,
  saveFileVaultSettings,
  stripEncryptedExtension,
  type FileVaultSettings,
} from '@/lib/crypto/fileVaultCrypto';
import { useToast } from '@/hooks/use-toast';
import {
  getFiles,
  createFolder as serverCreateFolder,
  uploadAndRegisterFile,
  getFolderPath,
  deleteFileOrFolder,
  renameFileOrFolder,
  type FileItem
} from '@/lib/services/fileService';
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

const PageSkeleton = () => (
  <div className="container mx-auto max-w-5xl py-8 space-y-6">
    <Skeleton className="h-10 w-1/3" />
    <Skeleton className="h-8 w-1/4" />
    <div className="space-y-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  </div>
);

interface FileListItemProps {
  item: FileItem;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
  onOpen: (item: FileItem) => void;
  onRename: (item: FileItem) => void;
  onShare: (item: FileItem) => void;
  onDownload: (item: FileItem) => void;
  onDelete: (item: FileItem) => void;
  selectedItemsCount: number;
}

const FileListItem = ({ item, isSelected, onToggleSelection, onOpen, onRename, onShare, onDownload, onDelete, selectedItemsCount }: FileListItemProps) => {
  const isFolder = item.type === 'folder';
  const Icon = isFolder ? FolderIcon : FileIcon;

  const handleRowClick = () => {
    if (selectedItemsCount > 0) {
        onToggleSelection(item.id);
    } else {
        onOpen(item);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ') { 
      e.preventDefault();
      onToggleSelection(item.id);
    }
  };
  
  return (
    <div
      className={cn(
        "group flex items-center p-2 rounded-lg cursor-pointer",
        isSelected ? "bg-accent" : "hover:bg-muted"
      )}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="row"
      aria-selected={isSelected}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggleSelection(item.id)}
        className="mr-4"
        onClick={(e) => e.stopPropagation()} // Prevent row click from firing
        aria-label={`Selecionar ${item.name}`}
      />
      <div 
        className="flex flex-1 items-center min-w-0"
      >
        <Icon className="h-6 w-6 mr-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <p className="font-medium truncate">
            {isEncryptedFileName(item.name) ? stripEncryptedExtension(item.name) : item.name}
          </p>
          {isEncryptedFileName(item.name) && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary shrink-0 gap-1">
              <Lock className="h-2.5 w-2.5" />
              AES-256
            </Badge>
          )}
        </div>
      </div>
      <div className="text-sm text-muted-foreground hidden sm:block w-40 text-right shrink-0">
        {item.createdAt ? formatDistanceToNow(item.createdAt.toDate(), { addSuffix: true }) : '...'}
      </div>
      <div className="text-sm text-muted-foreground hidden md:block w-32 text-right shrink-0">
        {item.size ? `${(item.size / 1024).toFixed(1)} KB` : '—'}
      </div>

      <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Opções para {item.name}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {!isFolder && (
                    <>
                        <DropdownMenuItem onSelect={() => onDownload(item)}>
                            <Download className="mr-2 h-4 w-4" />
                            <span>Baixar</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onShare(item)}>
                            <Share2 className="mr-2 h-4 w-4" />
                            <span>Compartilhar</span>
                        </DropdownMenuItem>
                    </>
                )}
                <DropdownMenuItem onSelect={() => onRename(item)}>
                    <Edit className="mr-2 h-4 w-4" />
                    <span>Renomear</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onDelete(item)} className="text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>Excluir</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};


export default function FilesPage() {
  const t = useTranslations('FilesPage');
  const locale = useLocale();
  const { currentUser, isLoading: isUserLoading } = useCurrentUser();
  const router = useRouter();
  const { toast } = useToast();
  const [showInfraSettings, setShowInfraSettings] = useState(false);
  const [vaultSettings, setVaultSettings] = useState<FileVaultSettings>(DEFAULT_FILE_VAULT_SETTINGS);
  const [p2pPrefs, setP2pPrefs] = useState<P2pPreferences>(DEFAULT_P2P_PREFERENCES);
  const [importKeyText, setImportKeyText] = useState('');

  const [items, setItems] = useState<FileItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  
  const [selectedItems, setSelectedItems] = useState(new Set<string>());
  const [itemsToDelete, setItemsToDelete] = useState<FileItem[]>([]);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [itemToRename, setItemToRename] = useState<FileItem | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newItemName, setNewItemName] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async (userId: string, folderId: string | null) => {
    setIsLoading(true);
    setSelectedItems(new Set()); // Clear selection on navigation
    try {
      const [fetchedItems, path] = await Promise.all([
        getFiles(userId, folderId),
        getFolderPath(folderId),
      ]);
      setItems(fetchedItems);
      setBreadcrumbs(path);
    } catch (error) {
      toast({ title: "Erro", description: "Não foi possível carregar os arquivos.", variant: 'destructive' });
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (currentUser) {
      fetchItems(currentUser.id, currentFolderId);
      setVaultSettings(getFileVaultSettings(currentUser.id));
      setP2pPrefs(getP2pPreferences(currentUser.id));
    }
  }, [currentUser, currentFolderId, fetchItems]);

  const downloadDecryptedItem = async (item: FileItem) => {
    if (!currentUser || !item.url) return;
    try {
      toast({ title: 'Decifrando arquivo localmente...', description: stripEncryptedExtension(item.name) });
      const res = await fetch(item.url);
      if (!res.ok) throw new Error('Falha ao baixar os bytes cifrados.');
      const cipherBuffer = await res.arrayBuffer();
      const plainBuffer = await decryptFileBytes(cipherBuffer, currentUser.id);
      const blob = new Blob([plainBuffer]);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = stripEncryptedExtension(item.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (error: any) {
      toast({
        title: 'Erro ao decifrar arquivo',
        description: error?.message || 'Verifique se a chave local do cofre está importada neste aparelho.',
        variant: 'destructive',
      });
    }
  };

  const handleOpenItem = (item: FileItem) => {
    if (item.type === 'folder') {
      setCurrentFolderId(item.id);
    } else if (item.url) {
      if (isEncryptedFileName(item.name)) {
        void downloadDecryptedItem(item);
      } else {
        window.open(item.url, '_blank');
      }
    }
  };

  const handleBreadcrumbClick = (folderId: string | null) => {
    setCurrentFolderId(folderId);
  };
  
  const handleCreateFolder = async () => {
    if (!currentUser || !newFolderName.trim() || isCreatingFolder) return;
    setIsCreatingFolder(true);
    try {
      await serverCreateFolder(currentUser.id, currentFolderId, newFolderName);
      toast({ title: "Pasta Criada", description: `A pasta "${newFolderName}" foi criada.` });
      fetchItems(currentUser.id, currentFolderId); // Refresh list
      setIsCreateFolderOpen(false); // Close dialog
      setNewFolderName(''); // Reset name
    } catch (error: any) {
      toast({ title: "Erro ao Criar Pasta", description: error.message, variant: 'destructive' });
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!currentUser) return;
    const filesArray = Array.from(files);
    if(filesArray.length === 0) return;
    
    setIsUploading(true);
    toast({ title: `Iniciando upload de ${filesArray.length} arquivo(s)...`});
    
    let successCount = 0;
    let errorCount = 0;

    for (const file of filesArray) {
        try {
            const fileToUpload = vaultSettings.encryptOnUpload
              ? await encryptFileForUpload(file, currentUser.id)
              : file;
            await uploadAndRegisterFile(currentUser.id, currentFolderId, fileToUpload);
            successCount++;
        } catch (error: any) {
            errorCount++;
            toast({ title: `Falha no Upload de "${file.name}"`, description: error.message, variant: 'destructive' });
        }
    }

    setIsUploading(false);
    if(fileInputRef.current) fileInputRef.current.value = "";
    
    if (successCount > 0) {
        toast({ title: "Upload Concluído", description: `${successCount} de ${filesArray.length} arquivo(s) salvos com sucesso.`});
        fetchItems(currentUser.id, currentFolderId); // Refresh list
    }
    if (errorCount > 0) {
        toast({ title: "Falhas no Upload", description: `${errorCount} arquivo(s) não puderam ser salvos.`, variant: 'destructive' });
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && currentUser) {
      handleUploadFiles(files);
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const handleToggleSelection = (itemId: string) => {
    setSelectedItems(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(itemId)) {
        newSelection.delete(itemId);
      } else {
        newSelection.add(itemId);
      }
      return newSelection;
    });
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedItems(new Set(items.map(item => item.id)));
    } else {
      setSelectedItems(new Set());
    }
  };

  const allSelected = selectedItems.size > 0 && selectedItems.size === items.length;
  const someSelected = selectedItems.size > 0 && selectedItems.size < items.length;

  const confirmDeletion = (itemsToDelete: FileItem[]) => {
    if (itemsToDelete.length === 0) return;
    setItemsToDelete(itemsToDelete);
    setIsDeleteConfirmOpen(true);
  };

  const executeDelete = async () => {
    if (itemsToDelete.length === 0 || !currentUser) return;
    setIsDeleting(true);

    const deletionPromises = itemsToDelete.map(item => deleteFileOrFolder(item, currentUser.id));
    
    try {
      await Promise.all(deletionPromises);
      toast({ title: `${itemsToDelete.length} item(s) excluído(s) com sucesso.` });
    } catch (error: any) {
      toast({ title: 'Erro ao excluir', description: 'Alguns itens não puderam ser excluídos.', variant: 'destructive' });
      console.error("Batch delete error:", error);
    }
    
    setItemsToDelete([]);
    setIsDeleteConfirmOpen(false);
    setIsDeleting(false);
    setSelectedItems(new Set());
    fetchItems(currentUser.id, currentFolderId);
  };

  const handleRenameItem = async () => {
      if (!itemToRename || !newItemName.trim() || !currentUser) return;
      setIsRenaming(true);
      try {
          await renameFileOrFolder(itemToRename.id, newItemName);
          toast({ title: 'Item renomeado', description: `"${itemToRename.name}" foi renomeado para "${newItemName}".` });
          fetchItems(currentUser.id, currentFolderId);
      } catch (error: any) {
          toast({ title: 'Erro ao renomear', description: error.message, variant: 'destructive' });
      } finally {
          setIsRenaming(false);
          setItemToRename(null);
          setNewItemName("");
      }
  };

  const handleDownloadItem = (item: FileItem) => {
      if (item.type === 'file' && item.url) {
          if (isEncryptedFileName(item.name)) {
            void downloadDecryptedItem(item);
          } else {
            window.open(item.url, '_blank');
          }
      } else {
          toast({ title: 'Ação não disponível', description: 'O download só está disponível para arquivos.', variant: 'default' });
      }
  };
  
  const handleShareItem = (item: FileItem) => {
      if (item.type === 'file' && item.url) {
          navigator.clipboard.writeText(item.url);
          toast({ title: 'Link copiado!', description: 'O link para o arquivo foi copiado para a área de transferência.' });
      } else {
          toast({ title: 'Ação não disponível', description: 'O compartilhamento só está disponível para arquivos.', variant: 'default' });
      }
  };

  if (isUserLoading) {
    return <PageSkeleton />;
  }

  if (!currentUser) {
    return (
        <div className="container mx-auto max-w-3xl py-8 text-center">
            <Card className="shadow-lg p-8">
                <FolderIcon className="mx-auto h-12 w-12 text-muted-foreground" />
                <h1 className="mt-4 text-2xl font-bold">Acesse seus Arquivos</h1>
                <p className="mt-2 text-muted-foreground">Faça login para gerenciar seus arquivos e pastas pessoais.</p>
                <Button onClick={() => router.push('/login')} className="mt-6">
                    <LogIn className="mr-2 h-4 w-4" /> Login
                </Button>
            </Card>
        </div>
    );
  }

  return (
    <>
      <Dialog open={!!itemToRename} onOpenChange={(open) => { if (!open) setItemToRename(null) }}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Renomear {itemToRename?.type}</DialogTitle>
                  <DialogDescription>
                      Digite um novo nome para &quot;{itemToRename?.name}&quot;.
                  </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                  <Label htmlFor="item-new-name" className="sr-only">Novo nome</Label>
                  <Input
                      id="item-new-name"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder="Novo nome do item"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleRenameItem(); } }}
                      autoFocus
                      disabled={isRenaming}
                  />
              </div>
              <DialogFooter>
                  <Button variant="outline" onClick={() => setItemToRename(null)} disabled={isRenaming}>Cancelar</Button>
                  <Button onClick={handleRenameItem} disabled={isRenaming || !newItemName.trim()}>
                      {isRenaming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Salvar
                  </Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
      
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                  <AlertDialogDescription>
                      Esta ação não pode ser desfeita. Isso excluirá permanentemente {itemsToDelete.length} item(s).
                      Se uma pasta for selecionada, todo o seu conteúdo também será excluído.
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={executeDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                      {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Excluir
                  </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>

      <div className="container mx-auto max-w-5xl py-8">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4 px-4">
          <div className="space-y-1">
            <h1 className="text-xl font-bold flex items-center">
              <FolderIcon className="mr-3 h-6 w-6 text-primary" />
              {t('title')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
              {selectedItems.size > 0 ? (
                <>
                  <span className="text-sm font-medium text-muted-foreground">{selectedItems.size} selecionado(s)</span>
                  <AlertDialog>
                      <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" onClick={() => confirmDeletion(items.filter(item => selectedItems.has(item.id)))}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Excluir
                          </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta ação não pode ser desfeita. Isso excluirá permanentemente {selectedItems.size} item(s). Se uma pasta for selecionada, todo o seu conteúdo também será excluído.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                              <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => executeDelete()} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                  {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  Excluir
                              </AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : (
                <>
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple />
                  <Button
                    type="button"
                    variant={showInfraSettings ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setShowInfraSettings((v) => !v)}
                  >
                    <SlidersHorizontal className="mr-2 h-4 w-4 text-primary" />
                    P2P &amp; Cripto
                  </Button>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                      {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
                      {vaultSettings.encryptOnUpload ? 'Upload Cifrado' : 'Upload'}
                  </Button>
                  <AlertDialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
                      <AlertDialogTrigger asChild>
                          <Button><FolderPlus className="mr-2 h-4 w-4" /> Nova Pasta</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Criar Nova Pasta</AlertDialogTitle>
                            <AlertDialogDescription>
                              Digite um nome para a sua nova pasta.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <div className="py-4">
                            <Label htmlFor="folder-name" className="sr-only">Nome da Pasta</Label>
                            <Input
                              id="folder-name"
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              placeholder="Ex: Documentos Importantes"
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateFolder(); } }}
                              autoFocus
                              disabled={isCreatingFolder}
                            />
                          </div>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={isCreatingFolder}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleCreateFolder} disabled={isCreatingFolder || !newFolderName.trim()}>
                              {isCreatingFolder && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Criar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
          </div>
        </div>

        <nav className="flex items-center text-sm text-muted-foreground mb-4 px-4">
          <button onClick={() => handleBreadcrumbClick(null)} className="hover:underline flex items-center">
            <Home className="h-4 w-4 mr-1.5" /> Início
          </button>
          {breadcrumbs.map((crumb) => (
            <React.Fragment key={crumb.id}>
              <ChevronRight className="h-4 w-4 mx-1" />
              <button onClick={() => handleBreadcrumbClick(crumb.id)} className="hover:underline">
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {showInfraSettings && currentUser && (
          <Card className="mb-4 mx-2 sm:mx-0 border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Controle Total · Infra P2P &amp; Criptografia de Arquivos
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild className="h-7 text-xs">
                    <Link href={`/${locale}/keys`}>
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                      Chaves
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild className="h-7 text-xs">
                    <Link href={`/${locale}/settings/p2p`}>Aparelhos P2P</Link>
                  </Button>
                </div>
              </div>
              <CardDescription className="text-xs">
                Configure aqui como seus arquivos são cifrados no seu aparelho e sincronizados na rede P2P.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-primary" />
                    Criptografia Local AES-GCM-256 no Upload
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cifra o arquivo no seu dispositivo antes de enviar (.lulaenc). Só aparelhos com sua chave conseguem abrir.
                  </p>
                </div>
                <Switch
                  checked={vaultSettings.encryptOnUpload}
                  onCheckedChange={(checked) => {
                    const next = { ...vaultSettings, encryptOnUpload: checked };
                    setVaultSettings(next);
                    saveFileVaultSettings(currentUser.id, next);
                    toast({
                      title: checked ? 'Criptografia AES-GCM-256 ativada' : 'Criptografia automática desativada',
                      description: checked
                        ? 'Novos uploads serão cifrados localmente antes do envio.'
                        : 'Novos uploads serão enviados sem cifragem adicional.',
                    });
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Conexão P2P automática</p>
                  <p className="text-xs text-muted-foreground">
                    Conecta diretamente entre seus dispositivos autorizados e contatos sem passar pelo servidor central.
                  </p>
                </div>
                <Switch
                  checked={p2pPrefs.autoConnectP2p}
                  onCheckedChange={(checked) => {
                    const next = { ...p2pPrefs, autoConnectP2p: checked };
                    setP2pPrefs(next);
                    saveP2pPreferences(currentUser.id, next);
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Modo Zero-Banco por padrão (P2P)</p>
                  <p className="text-xs text-muted-foreground">
                    Mantém dados trafegando exclusivamente ponta-a-ponta quando o par estiver online.
                  </p>
                </div>
                <Switch
                  checked={p2pPrefs.defaultZeroDbOnly}
                  onCheckedChange={(checked) => {
                    const next = { ...p2pPrefs, defaultZeroDbOnly: checked };
                    setP2pPrefs(next);
                    saveP2pPreferences(currentUser.id, next);
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Ocultar meu IP (somente relay TURN)</p>
                  <p className="text-xs text-muted-foreground">
                    Evita expor seu endereço IP direto durante transferências P2P.
                  </p>
                </div>
                <Switch
                  checked={p2pPrefs.relayOnly}
                  onCheckedChange={(checked) => {
                    const next = { ...p2pPrefs, relayOnly: checked };
                    setP2pPrefs(next);
                    saveP2pPreferences(currentUser.id, next);
                  }}
                />
              </div>

              <div className="pt-2 border-t border-border/60 space-y-2">
                <p className="text-xs font-semibold">Chave Local do Cofre de Arquivos (Portabilidade)</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      const secret = exportLocalFileSecret(currentUser.id);
                      void navigator.clipboard.writeText(secret);
                      toast({
                        title: 'Chave copiada!',
                        description: 'Importe esta chave no seu outro aparelho para decifrar seus arquivos .lulaenc.',
                      });
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copiar Chave Local
                  </Button>
                  <div className="flex flex-1 min-w-[200px] gap-1.5">
                    <Input
                      value={importKeyText}
                      onChange={(e) => setImportKeyText(e.target.value)}
                      placeholder="Cole chave de outro aparelho..."
                      className="h-8 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs shrink-0"
                      disabled={importKeyText.trim().length < 16}
                      onClick={() => {
                        const ok = importLocalFileSecret(currentUser.id, importKeyText);
                        if (ok) {
                          setImportKeyText('');
                          toast({ title: 'Chave importada!', description: 'Agora este aparelho decifra seus arquivos.' });
                        } else {
                          toast({ title: 'Chave inválida', variant: 'destructive' });
                        }
                      }}
                    >
                      Importar
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn("relative min-h-[200px] rounded-none", isDraggingOver && "border-primary border-dashed border-2")}
        >
          <div className="flex items-center p-2 border-b text-sm font-medium text-muted-foreground">
            <Checkbox
              className="mr-4"
              checked={allSelected ? true : (someSelected ? 'indeterminate' : false)}
              onCheckedChange={handleSelectAll}
              aria-label="Selecionar todos os itens"
            />
            <div className="flex-1 min-w-0">Nome</div>
            <div className="hidden sm:block w-40 text-right shrink-0">Modificado</div>
            <div className="hidden md:block w-32 text-right shrink-0">Tamanho</div>
            <div className="w-8 h-8 ml-2 shrink-0" /> {/* Spacer for options button */}
          </div>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : items.length > 0 ? (
              <div className="divide-y divide-border">
                {items.map(item => (
                  <FileListItem
                    key={item.id}
                    item={item}
                    isSelected={selectedItems.has(item.id)}
                    onToggleSelection={handleToggleSelection}
                    onOpen={handleOpenItem}
                    onRename={() => {
                        setNewItemName(item.name);
                        setItemToRename(item);
                    }}
                    onShare={handleShareItem}
                    onDownload={handleDownloadItem}
                    onDelete={() => confirmDeletion([item])}
                    selectedItemsCount={selectedItems.size}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <FileX2 className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">Esta pasta está vazia.</p>
              </div>
            )}
          </CardContent>
          {isDraggingOver && (
              <div className="absolute inset-0 bg-primary/20 flex flex-col items-center justify-center pointer-events-none rounded-lg">
                  <UploadCloud className="h-16 w-16 text-primary" />
                  <p className="mt-2 text-lg font-semibold text-primary">Solte os arquivos para upload</p>
              </div>
          )}
        </Card>
      </div>
    </>
  );
}
