'use client';

import { useState, useEffect } from 'react';

/**
 * A custom React hook that tracks the height of the visual viewport.
 * This is particularly useful on mobile devices where the visual viewport
 * changes size when the on-screen keyboard appears or disappears.
 * It returns the current height of the visual viewport in pixels, or null
 * if the API is not available or during server-side rendering.
 *
 * @returns {number | null} The height of the visual viewport, or null.
 */
export function useVisualViewport(): number | null {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    // This hook only works in a browser environment with visualViewport support.
    if (typeof window === 'undefined' || !window.visualViewport) {
      return;
    }

    const handleResize = () => {
      // Set the height, ensuring it's never zero to avoid layout collapses.
      // Use window.innerHeight as a fallback if visualViewport height is somehow 0.
      const newHeight = window.visualViewport.height > 0 ? window.visualViewport.height : window.innerHeight;
      setViewportHeight(newHeight);
    };

    // Set initial height
    handleResize();

    // Add event listener for subsequent resizes (like keyboard appearing)
    window.visualViewport.addEventListener('resize', handleResize);

    // Cleanup the event listener when the component unmounts
    return () => {
      window.visualViewport.removeEventListener('resize', handleResize);
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  return viewportHeight;
}
