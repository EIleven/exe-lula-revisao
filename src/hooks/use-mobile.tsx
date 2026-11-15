import { useMediaQuery } from "@/hooks/use-media-query"

const MOBILE_BREAKPOINT = 799

// Um único ouvinte para o app inteiro (veja use-media-query). No servidor e na hidratação o valor é sempre `false`; no
// navegador ele troca logo em seguida.
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`)
}
