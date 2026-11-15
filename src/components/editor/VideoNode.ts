// src/components/editor/VideoNode.ts
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import VideoNodeView from './VideoNodeView';

export default Node.create({
  name: 'videoNode',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video[src]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoNodeView);
  },
});
