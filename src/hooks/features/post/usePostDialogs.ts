// src/hooks/features/post/usePostDialogs.ts
import { useState } from 'react';
import { usePathname } from 'next/navigation';

export function usePostDialogs() {
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [promptActionName, setPromptActionName] = useState('');
  const [isQuoteDialogOpen, setIsQuoteDialogOpen] = useState(false);
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const pathname = usePathname(); // For LoginOrRegisterPromptDialog

  const openLoginPrompt = (actionName: string) => {
    setPromptActionName(actionName);
    setShowLoginPrompt(true);
  };

  return {
    // Login Prompt Dialog
    showLoginPrompt,
    setShowLoginPrompt,
    promptActionName,
    openLoginPrompt,
    currentPath: pathname, // Pass along for the dialog

    // Quote Dialog
    isQuoteDialogOpen,
    setIsQuoteDialogOpen,
    
    // Comment Dialog
    isCommentDialogOpen,
    setIsCommentDialogOpen,

    // Edit Dialog
    isEditDialogOpen,
    setIsEditDialogOpen,
  };
}
