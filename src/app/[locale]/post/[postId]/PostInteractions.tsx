// src/app/post/[postId]/PostInteractions.tsx
'use client';
import { useEffect } from 'react';

export function PostInteractions() {
  useEffect(() => {
    if (window.location.hash) {
      const hash = window.location.hash;
      const elementId = hash.substring(1);
      if (!elementId.startsWith('comment-')) return;

      const element = document.getElementById(elementId);
      if (element) {
        const timer = setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.style.transition = 'background-color 0.5s ease-in-out';
          element.style.backgroundColor = 'hsl(var(--primary) / 0.1)';
          
          const resetTimer = setTimeout(() => {
            if (element) {
              element.style.backgroundColor = '';
            }
          }, 2500);
          
          return () => clearTimeout(resetTimer);
        }, 500);
        
        return () => clearTimeout(timer);
      }
    }
  }, []); // Empty dependency array ensures this runs once on mount

  return null;
}
