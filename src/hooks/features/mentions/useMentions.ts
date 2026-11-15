// src/hooks/features/mentions/useMentions.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// This regex now looks for a trigger (@ or #) that is either at the start of the text
// or preceded by a whitespace character. It captures the trigger and the search term
// (including dots, hyphens, and secondary '@' for Fediverse handles like @user@domain).
const MENTION_HASHTAG_REGEX = /(?<=^|\s)([#@])([a-zA-Z0-9_.\-@]*)$/;

export type SuggestionType = 'user' | 'hashtag';

export function useMentions(
  text: string,
  triggerRef: React.RefObject<HTMLTextAreaElement>
) {
  const [suggestionType, setSuggestionType] = useState<SuggestionType | null>(null);
  const [suggestionQuery, setSuggestionQuery] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const mentionStartPositionRef = useRef<number | null>(null);

  useEffect(() => {
    const cursorPosition = triggerRef.current?.selectionStart;
    if (cursorPosition === undefined) return;

    const textBeforeCursor = text.substring(0, cursorPosition);
    const match = textBeforeCursor.match(MENTION_HASHTAG_REGEX);
    
    if (match) {
      const [ , trigger, query ] = match;
      setSuggestionType(trigger === '@' ? 'user' : 'hashtag');
      setSuggestionQuery(query);
      mentionStartPositionRef.current = cursorPosition - query.length - 1; // Position of the '@' or '#'
      setSuggestionsOpen(true);
    } else {
      setSuggestionsOpen(false);
      setSuggestionQuery(null);
      setSuggestionType(null);
    }
  }, [text, triggerRef]);

  const handleSelect = useCallback(
    (selectedValue: string) => {
      const start = mentionStartPositionRef.current;
      if (start === null || suggestionType === null) return;
      
      const textToInsert = suggestionType === 'user' ? `@${selectedValue} ` : `#${selectedValue} `;
      
      const newText =
        text.substring(0, start) +
        textToInsert +
        text.substring(start + (suggestionQuery?.length || 0) + 1);

      // We don't call onTextChange directly, instead we expect the parent component
      // to handle the state update based on this function's return value.
      setSuggestionsOpen(false);
      setSuggestionQuery(null);
      setSuggestionType(null);

      // Return the new text and the cursor position for the parent component to handle
      const newCursorPosition = start + textToInsert.length;
      return { newText, newCursorPosition };
    },
    [text, suggestionQuery, suggestionType]
  );

  return {
    suggestionType,
    suggestionQuery,
    suggestionsOpen,
    setSuggestionsOpen,
    handleSelect,
  };
}
