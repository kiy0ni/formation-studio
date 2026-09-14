import { create } from 'zustand';

export const useSaveStatus = create<{ state: 'idle' | 'saving' | 'saved' | 'error'; at: number }>(() => ({ state: 'idle', at: 0 }));
