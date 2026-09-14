import { create } from 'zustand';
import { db } from '../lib/db';
import type { Choreo, Folder, Team } from '../lib/types';

interface LibraryState {
  choreos: Choreo[];
  teams: Team[];
  folders: Folder[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useLibrary = create<LibraryState>((set) => ({
  choreos: [],
  teams: [],
  folders: [],
  loaded: false,
  refresh: async () => {
    const [choreos, teams, folders] = await Promise.all([db.listChoreos(), db.listTeams(), db.listFolders()]);
    set({
      choreos: choreos.sort((a, b) => b.updatedAt - a.updatedAt),
      teams: teams.sort((a, b) => b.updatedAt - a.updatedAt),
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      loaded: true,
    });
  },
}));
