export const extractHashtagsFromString = (text: string | undefined): string[] => {
    if (!text) return [];
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    const matches = text.match(hashtagRegex);
    return matches ? [...new Set(matches)] : [];
};