// src/components/editor/ArticleEditor.tsx

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import ListItem from '@tiptap/extension-list-item';
import { TextAlign } from '@tiptap/extension-text-align';
import ResizableImage from './ResizableImage';
import YoutubeNode from './YoutubeNode';
import VideoNode from './VideoNode'; // Adicionado
import './editor-styles.css';
import { Toolbar, type ArticleFontStyle } from './Toolbar';
import { extractYoutubeVideoInfo } from '@/lib/utils/textUtils';
import { isLikelyVideoFile } from '@/lib/services/mediaUploadService';
import { cn } from '@/lib/utils';

interface ArticleEditorProps {
  content: string;
  onUpdate: (htmlContent: string) => void;
  onImageUpload: (file: File) => Promise<string | null>;
  editorRef?: React.RefObject<Editor>;
  placeholder?: string;
  fontStyle?: ArticleFontStyle;
  onFontStyleChange?: (style: ArticleFontStyle) => void;
}

const ArticleEditor = ({
  content,
  onUpdate,
  onImageUpload,
  editorRef,
  placeholder,
  fontStyle: externalFontStyle,
  onFontStyleChange,
}: ArticleEditorProps) => {
  const [internalFontStyle, setInternalFontStyle] = useState<ArticleFontStyle>('sans');
  const fontStyle = externalFontStyle ?? internalFontStyle;
  const setFontStyle = onFontStyleChange ?? setInternalFontStyle;
  const insertDroppedMedia = async (files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith('image/') && !isLikelyVideoFile(file)) continue;
      const url = await onImageUpload(file);
      if (!url) continue;
      editor?.chain().focus().insertContent({
        type: file.type.startsWith('image/') ? 'resizableImage' : 'videoNode',
        attrs: { src: url },
      }).run();
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'resizableImage'],
      }),
      TextStyle,
      ListItem,
      YoutubeNode,
      VideoNode, // Adicionado
    ],
    content: content,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base dark:prose-invert w-full max-w-full min-w-0 break-words focus:outline-none p-4 sm:p-5 min-h-[260px] sm:min-h-[340px]',
        'data-placeholder': placeholder || '',
      },
      handlePaste: (view, event, slice) => {
        const files = Array.from(event.clipboardData?.files ?? [])
          .filter((file) => file.type.startsWith('image/') || isLikelyVideoFile(file));
        if (files.length > 0) {
          void insertDroppedMedia(files);
          return true;
        }
        const text = event.clipboardData?.getData('text/plain');
        if (text) {
          const { videoId } = extractYoutubeVideoInfo(text);
          if (videoId) {
            editor?.chain().focus().insertContent({
              type: 'youtube',
              attrs: { videoId },
            }).run();
            return true;
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
          .filter((file) => file.type.startsWith('image/') || isLikelyVideoFile(file));
        if (files.length === 0) return false;
        event.preventDefault();
        void insertDroppedMedia(files);
        return true;
      },
    },
  });

  React.useImperativeHandle(editorRef, () => editor!, [editor]);

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const currentHtml = editor.getHTML();
    if (content && content !== currentHtml) {
      editor.commands.setContent(content, false);
    }
  }, [content, editor]);

  const stats = useMemo(() => {
    const text = editor?.getText() || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const minutes = Math.max(1, Math.ceil(words / 200));
    return { words, minutes };
  }, [editor, content]);

  if (!editor) {
    return null;
  }

  return (
    <div className="w-full max-w-full min-w-0 border border-input rounded-lg overflow-hidden flex flex-col bg-background">
        <div className="sticky top-0 z-10 w-full max-w-full min-w-0 bg-background/95 backdrop-blur-sm">
            <Toolbar
              editor={editor}
              onImageUpload={onImageUpload}
              fontStyle={fontStyle}
              onFontStyleChange={setFontStyle}
            />
        </div>
        <div className={cn("w-full max-w-full min-w-0 overflow-y-auto overflow-x-hidden", fontStyle === 'serif' ? 'font-serif' : 'font-sans')}>
            <EditorContent editor={editor} className="w-full max-w-full min-w-0" />
        </div>
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/15 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>
            {stats.words} {stats.words === 1 ? 'palavra' : 'palavras'}
            {stats.words > 0 ? ` · ~${stats.minutes} min de leitura` : ''}
          </span>
          <span className="hidden sm:inline">Arraste ou cole imagens, vídeos e links do YouTube</span>
        </div>
    </div>
  );
};

export default ArticleEditor;
