// Save files: download a save to keep it safe (or move it to another device) and load it back.
import { VERSION } from '../data/meta';
import type { SaveFile, SaveMeta } from './storage';

const FORMAT = 'pizzasim-save';

export interface ExportedSave {
  format: typeof FORMAT;
  game: string;
  exportedAt: number;
  meta: SaveMeta;
  data: string;
}

/** Download a save as a .json file the player can keep anywhere. */
export function exportSave(f: SaveFile) {
  const out: ExportedSave = { format: FORMAT, game: VERSION, exportedAt: Date.now(), meta: f.meta, data: f.data };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safe = f.meta.company.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) || 'Pizzeria';
  const a = document.createElement('a');
  a.href = url;
  a.download = `PizzaSim-${safe}-day${f.meta.day}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return a.download;
}

/** Read a save file chosen by the player. Returns the game state JSON string, or throws a friendly error. */
export async function readSaveFile(file: File): Promise<{ data: string; meta?: SaveMeta }> {
  if (file.size > 20 * 1024 * 1024) throw new Error("That file is too big to be a Pizza SIM save.");
  const text = await file.text();
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Pizza SIM save.");
  }
  const o = obj as Partial<ExportedSave> & { stores?: unknown };
  if (o && o.format === FORMAT && typeof o.data === 'string') return { data: o.data, meta: o.meta };
  // a raw game state works too
  if (o && Array.isArray(o.stores)) return { data: text };
  throw new Error("That file isn't a Pizza SIM save.");
}
