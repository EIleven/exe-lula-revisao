// src/components/editor/VideoNodeView.tsx
'use client';

import React from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import PlatformVideo from '@/components/shared/PlatformVideo';

const VideoNodeView = ({ node }: { node: any }) => {
  const { src } = node.attrs;

  return (
    <NodeViewWrapper as="div" className="my-4 flex justify-center w-full max-w-full">
      <PlatformVideo
        src={src}
        controls
        className="max-w-full w-full sm:w-auto max-h-[65vh] rounded-lg border border-border"
        style={{ maxWidth: '100%', borderRadius: '0.5rem', border: '1px solid hsl(var(--border))' }}
      >
        Seu navegador não suporta a tag de vídeo.
      </PlatformVideo>
    </NodeViewWrapper>
  );
};

export default VideoNodeView;
