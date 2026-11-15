// src/lib/utils/adUtils.ts

// THIS FILE IS NO LONGER USED FOR IN-ARTICLE AD INJECTION.
// The logic has been moved to a component-based approach in PostCardContent.tsx
// to avoid client-side hydration issues and zero-width container errors.
// This file is kept for potential future use or reference but is currently deprecated
// for its original purpose.

/**
 * DEPRECATED: Injects ad placeholders into an HTML string for later client-side rendering.
 * @param html The HTML content of the article.
 * @returns The HTML string with ad placeholders.
 */
export function injectAdsIntoHtml(html: string): string {
  console.warn("injectAdsIntoHtml is deprecated and should not be used for in-article ads.");
  // Return original HTML as this logic is now handled client-side.
  return html;
}
