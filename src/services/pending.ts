import { create } from 'zustand';

/**
 * The scorekeeping link just scanned. Held in memory only, so the token never goes
 * into a route URL or navigation state; it is saved to SecureStore per game when a
 * game is opened.
 */
export const usePendingLink = create<{
  link: { serverId: number; linkToken: string } | null;
  set: (link: { serverId: number; linkToken: string } | null) => void;
}>((set) => ({ link: null, set: (link) => set({ link }) }));
