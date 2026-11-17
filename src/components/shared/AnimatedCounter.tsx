// src/components/shared/AnimatedCounter.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { compactCount, exactCountTitle } from '@/lib/media/videoQueue';

interface AnimatedCounterProps {
  count: number;
  className?: string;
}

const AnimatedCounter: React.FC<AnimatedCounterProps> = ({ count, className }) => {
  const [prevCount, setPrevCount] = useState(count);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (count > prevCount) {
      setDirection('up');
    } else if (count < prevCount) {
      setDirection('down');
    }

    const timer = setTimeout(() => {
      setPrevCount(count);
      setDirection(null);
    }, 300); // Duration of the animation must match CSS

    return () => clearTimeout(timer);
  }, [count]);

  const prevNumberToDisplay = compactCount(prevCount);
  const currentNumberToDisplay = compactCount(count);
  const exactTitle = exactCountTitle(count);

  let translationClass = '';
  if (direction === 'up') {
    translationClass = 'animate-scroll-up';
  } else if (direction === 'down') {
    translationClass = 'animate-scroll-down';
  }

  return (
    <div className={cn("animated-counter", className)} title={exactTitle}>
      <div className={translationClass}>
        <span className="animated-counter-number">
          {direction ? prevNumberToDisplay : currentNumberToDisplay}
        </span>
        {direction && (
          <span className="animated-counter-number">
            {currentNumberToDisplay}
          </span>
        )}
      </div>
    </div>
  );
};

export default AnimatedCounter;
