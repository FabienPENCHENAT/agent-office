import * as fs from 'fs';
import * as path from 'path';
import { RawSettings } from '../core/settings';

/** Fichier settings.json de l'application : mêmes clés que `agentOffice.*` dans VS Code, plus les dossiers de projet. */
export interface StandaloneFile extends RawSettings {
  /** Dossiers de projet dont le `.claude/agents` est lu (équivalent des dossiers ouverts dans VS Code). */
  projectFolders?: unknown;
}

export const SETTINGS_TEMPLATE = {
  claudeConfigDir: '',
  pollIntervalSeconds: 2,
  subagentSilenceMinutes: 20,
  pinnedAgents: [],
  showDefaultClaude: true,
  christmasDecor: 'auto',
  agentRooms: {},
  projectFolders: [],
};

/** Lit le fichier ; un fichier absent ou invalide donne des réglages vides (donc les valeurs par défaut). */
export function readSettingsFile(file: string): StandaloneFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StandaloneFile) : {};
  } catch {
    return {};
  }
}

/** Crée le fichier avec les valeurs par défaut s'il n'existe pas encore, pour pouvoir l'éditer à la main. */
export function ensureSettingsFile(file: string): void {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(SETTINGS_TEMPLATE, null, 2)}\n`);
  }
}

export function projectFolders(settings: StandaloneFile): string[] {
  return Array.isArray(settings.projectFolders)
    ? settings.projectFolders.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
}

/** État de l'application (hors réglages) : répertoires de travail récents et dernier répertoire ouvert. */
export interface AppState {
  /** Du plus récent au plus ancien. */
  recents: string[];
  lastFolder?: string;
}

export const MAX_RECENTS = 15;

export function readState(file: string): AppState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppState> | null;
    const recents = Array.isArray(parsed?.recents)
      ? parsed.recents.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    return { recents, lastFolder: typeof parsed?.lastFolder === 'string' ? parsed.lastFolder : undefined };
  } catch {
    return { recents: [] };
  }
}

export function writeState(file: string, state: AppState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Met un répertoire en tête de la liste (sans doublon, taille bornée) et le retient comme dernier ouvert. */
export function pushRecent(state: AppState, dir: string): AppState {
  const folder = path.resolve(dir);
  return { recents: [folder, ...state.recents.filter((p) => p !== folder)].slice(0, MAX_RECENTS), lastFolder: folder };
}

/** Retire un répertoire de la liste ; le répertoire lui-même n'est jamais touché. */
export function dropRecent(state: AppState, dir: string): AppState {
  const recents = state.recents.filter((p) => p !== dir);
  return { recents, lastFolder: state.lastFolder === dir ? recents[0] : state.lastFolder };
}
