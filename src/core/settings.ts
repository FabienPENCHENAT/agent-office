import * as os from 'os';
import * as path from 'path';

/** Réglages de l'office, identiques dans l'extension VS Code et dans l'application Electron. */
export interface OfficeSettings {
  claudeDir: string;
  pollMs: number;
  silenceMs: number;
  pinned: string[];
  rooms: Record<string, string>;
  showClaude: boolean;
  /** Décor de saison (aujourd'hui l'hiver), selon la date. */
  seasonal: boolean;
  /** `project` : seules les sessions lancées dans un dossier du projet ; `all` : toutes celles de la machine. */
  sessionScope: SessionScope;
}

export type SessionScope = 'project' | 'all';

/** Valeurs brutes lues dans `agentOffice.*` (VS Code) ou dans le fichier settings.json de l'application. */
export interface RawSettings {
  claudeConfigDir?: unknown;
  pollIntervalSeconds?: unknown;
  subagentSilenceMinutes?: unknown;
  pinnedAgents?: unknown;
  agentRooms?: unknown;
  showDefaultClaude?: unknown;
  seasonalDecor?: unknown;
  sessionScope?: unknown;
  /** Ancien réglage, remplacé par `seasonalDecor` : seul `off` est encore pris en compte. */
  christmasDecor?: unknown;
}

function num(value: unknown, fallback: number, min: number, max = Infinity): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Applique les valeurs par défaut et les bornes aux réglages bruts. */
export function resolveSettings(raw: RawSettings, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): OfficeSettings {
  const configured = typeof raw.claudeConfigDir === 'string' ? raw.claudeConfigDir.trim() : '';
  const rooms: Record<string, string> = {};
  if (raw.agentRooms && typeof raw.agentRooms === 'object') {
    for (const [name, room] of Object.entries(raw.agentRooms)) {
      if (typeof room === 'string') {
        rooms[name] = room;
      }
    }
  }
  return {
    claudeDir: configured || env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
    pollMs: num(raw.pollIntervalSeconds, 2, 1, 60) * 1000,
    silenceMs: num(raw.subagentSilenceMinutes, 20, 1) * 60_000,
    pinned: Array.isArray(raw.pinnedAgents) ? raw.pinnedAgents.filter((p): p is string => typeof p === 'string') : [],
    rooms,
    showClaude: typeof raw.showDefaultClaude === 'boolean' ? raw.showDefaultClaude : true,
    seasonal: typeof raw.seasonalDecor === 'boolean' ? raw.seasonalDecor : raw.christmasDecor !== 'off',
    sessionScope: raw.sessionScope === 'all' ? 'all' : 'project',
  };
}

/** Réglages modifiables depuis la roue crantée de l'office, avec leur valeur courante. */
export interface PanelSettings {
  sessionScope: SessionScope;
  showDefaultClaude: boolean;
  subagentSilenceMinutes: number;
  seasonalDecor: boolean;
}

/** Délais proposés dans la roue crantée ; une autre valeur reste possible dans les réglages. */
export const SILENCE_CHOICES = [5, 10, 20, 60];

export function panelSettings(c: OfficeSettings): PanelSettings {
  return {
    sessionScope: c.sessionScope,
    showDefaultClaude: c.showClaude,
    subagentSilenceMinutes: c.silenceMs / 60_000,
    seasonalDecor: c.seasonal,
  };
}

/**
 * Valide un réglage envoyé par la page : seules les clés de la roue crantée et leurs valeurs prévues sont acceptées.
 * Retourne undefined sinon.
 */
export function panelSetting(key: unknown, value: unknown): { key: keyof PanelSettings; value: PanelSettings[keyof PanelSettings] } | undefined {
  switch (key) {
    case 'sessionScope':
      return value === 'project' || value === 'all' ? { key, value } : undefined;
    case 'showDefaultClaude':
    case 'seasonalDecor':
      return typeof value === 'boolean' ? { key, value } : undefined;
    case 'subagentSilenceMinutes':
      return typeof value === 'number' && SILENCE_CHOICES.includes(value) ? { key, value } : undefined;
  }
  return undefined;
}
