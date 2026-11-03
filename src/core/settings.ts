import * as os from 'os';
import * as path from 'path';
import { ChristmasDecor } from '../state/season';

/** Réglages de l'office, identiques dans l'extension VS Code et dans l'application Electron. */
export interface OfficeSettings {
  claudeDir: string;
  pollMs: number;
  silenceMs: number;
  pinned: string[];
  rooms: Record<string, string>;
  showClaude: boolean;
  christmas: ChristmasDecor;
}

/** Valeurs brutes lues dans `agentOffice.*` (VS Code) ou dans le fichier settings.json de l'application. */
export interface RawSettings {
  claudeConfigDir?: unknown;
  pollIntervalSeconds?: unknown;
  subagentSilenceMinutes?: unknown;
  pinnedAgents?: unknown;
  agentRooms?: unknown;
  showDefaultClaude?: unknown;
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
  const christmas: ChristmasDecor =
    raw.christmasDecor === 'on' || raw.christmasDecor === 'off' ? raw.christmasDecor : 'auto';
  return {
    claudeDir: configured || env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
    pollMs: num(raw.pollIntervalSeconds, 2, 1, 60) * 1000,
    silenceMs: num(raw.subagentSilenceMinutes, 20, 1) * 60_000,
    pinned: Array.isArray(raw.pinnedAgents) ? raw.pinnedAgents.filter((p): p is string => typeof p === 'string') : [],
    rooms,
    showClaude: typeof raw.showDefaultClaude === 'boolean' ? raw.showDefaultClaude : true,
    christmas,
  };
}
