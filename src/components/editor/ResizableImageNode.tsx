
'use client';

import React, { useRef, useCallback, useState } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button'; // Import Button
import AltTextDialog from '@/components/shared/AltTextDialog'; // Import AltTextDialog

const ResizableImageNode: React.FC<NodeViewProps> = ({ node, updateAttributes, selected, editor }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isAltTextDialogOpen, setIsAltTextDialogOpen] = useState(false);

  const handleResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = imgRef.current?.offsetWidth || 0;
    const startHeight = imgRef.current?.offsetHeight || 0;
    
    // Use the editor's view width as the max constraint
    const maxWidth = editor.view.dom.clientWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      let newWidth = startWidth;
      
      if (handle.dataset.direction?.includes('right')) {
        newWidth = startWidth + (moveEvent.clientX - startX);
      } else if (handle.dataset.direction?.includes('left')) {
        newWidth = startWidth - (moveEvent.clientX - startX);
      }
      
      // Constrain width to a reasonable min/max
      newWidth = Math.max(50, Math.min(newWidth, maxWidth));

      updateAttributes({
        width: `${Math.round(newWidth)}px`,
        height: 'auto', // Keep aspect ratio
      });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [updateAttributes, editor.view.dom.clientWidth]);
  
  const handleAltTextSave = (altText: string) => {
    updateAttributes({ alt: altText });
    setIsAltTextDialogOpen(false);
  };

  // Destructure `textAlign`, `class`, and `style` to prevent invalid props from being passed to the <img> tag
  const { class: className, textAlign, style, ...otherAttrs } = node.attrs;
  const effectiveTextAlign = textAlign || 'center';

  return (
    <>
      <AltTextDialog
        isOpen={isAltTextDialogOpen}
        onOpenChange={setIsAltTextDialogOpen}
        initialAltText={node.attrs.alt}
        onSave={handleAltTextSave}
      />
      <NodeViewWrapper 
          className={cn("relative w-full max-w-full my-3", {
              'flex justify-center': effectiveTextAlign === 'center',
              'flex justify-start': effectiveTextAlign === 'left',
              'flex justify-end': effectiveTextAlign === 'right',
          })}
          data-text-align={effectiveTextAlign}
      >
        <div
          className="relative inline-block max-w-full box-border"
          style={{ width: node.attrs.width || undefined, maxWidth: '100%' }}
        >
          <img
              {...otherAttrs}
              ref={imgRef}
              className={cn("max-w-full h-auto block", className)}
              style={{ width: '100%', height: 'auto' }}
          />
          {selected && (
              <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="absolute top-2 left-2 z-10"
                onClick={(e) => {
                  e.preventDefault();
                  setIsAltTextDialogOpen(true);
                }}
                data-interactive="true"
              >
                ALT
              </Button>
              <div className="resize-handle top-left" data-direction="top-left" onMouseDown={handleResize}></div>
              <div className="resize-handle top-right" data-direction="top-right" onMouseDown={handleResize}></div>
              <div className="resize-handle bottom-left" data-direction="bottom-left" onMouseDown={handleResize}></div>
              <div className="resize-handle bottom-right" data-direction="bottom-right" onMouseDown={handleResize}></div>
              </>
          )}
        </div>
      </NodeViewWrapper>
    </>
  );
};

export default ResizableImageNode;
