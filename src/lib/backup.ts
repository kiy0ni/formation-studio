import { db } from './db';
import { download } from './exporters';
import type { Choreo, Folder, Team } from './types';

interface Backup {
  format: 'formation-studio-backup';
  version: 1;
  createdAt: number;
  choreos: Choreo[];
  teams: Team[];
  folders: Folder[];
  audio: Record<string, string>; // hash → data URL
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/** Whole library (choreographies, teams, folders and music) in one file. */
export async function exportBackup() {
  const [choreos, teams, folders] = await Promise.all([db.listChoreos(), db.listTeams(), db.listFolders()]);
  const audio: Record<string, string> = {};
  for (const hash of new Set(choreos.map((c) => c.music.hash).filter(Boolean) as string[])) {
    const blob = await db.getAudio(hash);
    if (blob) audio[hash] = await toDataUrl(blob);
  }
  const payload: Backup = { format: 'formation-studio-backup', version: 1, createdAt: Date.now(), choreos, teams, folders, audio };
  const date = new Date().toISOString().slice(0, 10);
  download(`formation-studio-sauvegarde-${date}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  return { choreos: choreos.length, teams: teams.length };
}

export const isBackup = (text: string) => text.slice(0, 200).includes('"formation-studio-backup"');

/** Merges a backup into the library; the most recently edited copy of each item wins. */
export async function importBackup(text: string) {
  const data = JSON.parse(text) as Backup;
  if (data.format !== 'formation-studio-backup') throw new Error('Fichier de sauvegarde non reconnu');
  const [choreos, teams] = await Promise.all([db.listChoreos(), db.listTeams()]);
  const localChoreos = new Map(choreos.map((c) => [c.id, c]));
  const localTeams = new Map(teams.map((t) => [t.id, t]));
  let c = 0;
  let t = 0;
  for (const doc of data.choreos ?? []) {
    const local = localChoreos.get(doc.id);
    if (local && local.updatedAt >= doc.updatedAt) continue;
    await db.saveChoreo(doc);
    c++;
  }
  for (const team of data.teams ?? []) {
    const local = localTeams.get(team.id);
    if (local && local.updatedAt >= team.updatedAt) continue;
    await db.saveTeam(team);
    t++;
  }
  for (const f of data.folders ?? []) await db.saveFolder(f);
  for (const [hash, url] of Object.entries(data.audio ?? {})) {
    // only sound embedded in the file itself, under a real hash name
    if (typeof url !== 'string' || !url.startsWith('data:') || !/^[a-f0-9]{16,64}$/.test(hash)) continue;
    if (await db.getAudio(hash)) continue;
    const blob = await (await fetch(url)).blob();
    await db.putAudio(hash, blob);
  }
  return { choreos: c, teams: t };
}
