// src/components/editor/ResizableImage.ts
import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import ResizableImageNode from './ResizableImageNode';

// Extend the official Tiptap Image extension
export default Image.extend({
  name: 'resizableImage',

  addAttributes() {
    return {
      // Inherit all attributes from the original Image extension
      ...this.parent?.(),
      width: {
        default: '100%',
        renderHTML: attributes => ({
          width: attributes.width,
        }),
      },
      height: {
        default: 'auto',
        renderHTML: attributes => ({
          height: attributes.height,
        }),
      },
      class: {
        default: '',
        renderHTML: (attributes) => ({
          class: attributes.class,
        }),
        parseHTML: (element) => element.getAttribute('class'),
      },
      // For text-align support
      textAlign: {
        default: 'center',
        renderHTML: attributes => ({
            'data-text-align': attributes.textAlign,
        }),
        parseHTML: (element) => element.getAttribute('data-text-align') || 'center',
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageNode);
  },
});
