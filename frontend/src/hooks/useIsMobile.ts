import { useBreakpoint } from './useBreakpoint';

export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}
