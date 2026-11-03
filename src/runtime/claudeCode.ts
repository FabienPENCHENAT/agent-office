import { realpathSync, type Stats } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ActivitySignal, Delegation, RuntimeReport, SubagentRun } from '../types';

/**
 * Adaptateur Claude Code — strictement en lecture seule.
 *
 * Sources utilisées :
 *  1. `<claudeDir>/sessions/<pid>.json` : registre des sessions tenu par Claude Code
 *     (`pid`, `sessionId`, `cwd`, `status: "busy" | "idle"`, `updatedAt`, `agent?`).
 *     Une session dont le processus n'existe plus est considérée comme expirée et ignorée.
 *  2. Agent principal d'une session : champ `agent` du registre, sinon l'entrée
 *     `{"type":"agent-setting","agentSetting":"<nom>"}` en tête du transcript.
 *  3. Sous-agents : `<claudeDir>/projects/<projet>/<sessionId>/subagents/agent-*.meta.json`
 *     (`agentType`, `finished`, `spawnDepth`). Un sous-agent non terminé d'une session vivante est actif.
 *     Chaque sous-agent non terminé est aussi remonté comme instance (`subagents`), pour les mini-bots.
 *  4. Délégations : un sous-agent de profondeur 1 a été lancé par l'agent principal de sa session.
 *     Lancement = création du transcript du sous-agent ; fin = écriture de `finished: true`.
 *  5. Portée : avec des dossiers de projet, seules les sessions dont le `cwd` est dans l'un d'eux sont lues.
 *  6. Session sans agent principal : attribuée à `defaultAgent` (le personnage « Claude ») s'il est fourni,
 *     avec le modèle lu dans le dernier champ `"model"` de la fin du transcript.
 *
 * Aucun contenu de conversation n'est conservé ni transmis : seuls le nom d'agent,
 * l'état et un horodatage sortent de ce module.
 */

interface SubagentInfo {
  id: string;
  agentType: string;
  depth: number;
  startedAt: number;
  finishedAt?: number;
  /** Absent pour un sous-agent terminé. */
  signal?: ActivitySignal;
}

export interface ClaudeAdapterOptions {
  claudeDir: string;
  /** Au-delà, un sous-agent non terminé et silencieux passe à « inconnu ». */
  subagentSilenceMs: number;
  /** Au-delà, un sous-agent non terminé et silencieux est considéré comme expiré. */
  subagentExpiryMs?: number;
  /** Durée pendant laquelle une délégation terminée reste signalée à la vue. */
  finishedWindowMs?: number;
  now?: () => number;
  isPidAlive?: (pid: number) => boolean;
  /** Nom attribué à l'agent principal d'une session lancée sans `--agent`. Absent : ces sessions sont ignorées. */
  defaultAgent?: string;
}

interface SessionRecord {
  pid: number;
  sessionId: string;
  cwd?: string;
  status?: unknown;
  agent?: unknown;
  updatedAt?: number;
  statusUpdatedAt?: number;
}

export function defaultIsPidAlive(pid: number): boolean {
  try {
    // Le signal 0 ne fait que tester l'existence du processus.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Teste si un dossier de travail est l'un de ces dossiers ou l'un de leurs sous-dossiers. Les liens symboliques des
 * dossiers sont résolus (Claude Code note le chemin réel), et la casse est ignorée sur macOS et Windows.
 */
export function cwdMatcher(dirs: string[], platform: NodeJS.Platform = process.platform): (cwd: string | undefined) => boolean {
  const fold = platform === 'linux' ? (p: string) => p : (p: string) => p.toLowerCase();
  const roots = new Set<string>();
  for (const dir of dirs) {
    roots.add(fold(path.resolve(dir)));
    try {
      roots.add(fold(realpathSync(dir)));
    } catch {
      // dossier introuvable : seul son chemin tel quel compte
    }
  }
  return (cwd) => {
    if (!cwd) {
      return false;
    }
    const c = fold(path.resolve(cwd));
    return [...roots].some((r) => {
      const rel = path.relative(r, c);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  };
}

/** Convention de Claude Code pour nommer le dossier de projet à partir du cwd. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

const HEAD_BYTES = 64 * 1024;

/** Lit uniquement l'en-tête du transcript pour y trouver le réglage d'agent principal. */
async function readAgentSetting(transcript: string): Promise<string | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(transcript, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    let found: string | undefined;
    for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (!line.includes('"agent-setting"')) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (entry?.type === 'agent-setting' && typeof entry.agentSetting === 'string') {
          found = entry.agentSetting;
        }
      } catch {
        // Ligne tronquée à la limite de lecture : ignorée.
      }
    }
    return found;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** « claude-opus-5-5 » → « Opus 5.5 » ; un suffixe de date (« -20250514 ») est retiré. */
export function modelLabel(id: string): string {
  const parts = id.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
  const family = parts.shift() ?? '';
  return [family.charAt(0).toUpperCase() + family.slice(1), parts.join('.')].filter(Boolean).join(' ');
}

/** Lit uniquement la fin du transcript pour y trouver le dernier modèle Claude utilisé. Rien d'autre n'est conservé. */
async function readModel(transcript: string): Promise<string | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(transcript, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, HEAD_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const ids = buffer.toString('utf8').match(/"model":"claude-[a-z0-9.-]+"/g);
    return ids ? modelLabel(ids[ids.length - 1].slice(9, -1)) : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

async function findSessionDir(projectsDir: string, session: SessionRecord): Promise<string | undefined> {
  const candidates: string[] = [];
  if (session.cwd) {
    candidates.push(path.join(projectsDir, projectDirName(session.cwd)));
  }
  try {
    for (const entry of await fs.readdir(projectsDir)) {
      candidates.push(path.join(projectsDir, entry));
    }
  } catch {
    return undefined;
  }
  for (const dir of candidates) {
    try {
      await fs.stat(path.join(dir, `${session.sessionId}.jsonl`));
      return dir;
    } catch {
      // essai suivant
    }
  }
  return undefined;
}

export class ClaudeCodeAdapter {
  private readonly agentSettingCache = new Map<string, string | null>();
  private readonly sessionDirCache = new Map<string, string>();
  private readonly metaCache = new Map<string, { mtimeMs: number; finished: boolean }>();
  private readonly modelCache = new Map<string, { mtimeMs: number; model?: string }>();

  constructor(private readonly options: ClaudeAdapterOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** `scope` : dossiers de projet dont les sessions sont lues ; absent, toutes les sessions de la machine le sont. */
  async read(scope?: string[]): Promise<RuntimeReport> {
    const inScope = scope ? cwdMatcher(scope) : () => true;
    const sessionsDir = path.join(this.options.claudeDir, 'sessions');
    let files: string[];
    try {
      files = (await fs.readdir(sessionsDir)).filter((f) => f.endsWith('.json'));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return {
        health: {
          runtime: 'claude-code',
          status: 'unavailable',
          message:
            code === 'ENOENT'
              ? `Session registry not found (${sessionsDir}).`
              : `Session registry unreadable (${code ?? 'error'}).`,
        },
        signals: [],
      };
    }

    const isAlive = this.options.isPidAlive ?? defaultIsPidAlive;
    const signals: ActivitySignal[] = [];
    const delegations: Delegation[] = [];
    const subagents: SubagentRun[] = [];
    let unreadable = 0;
    const liveIds = new Set<string>();

    for (const file of files) {
      let session: SessionRecord;
      try {
        session = JSON.parse(await fs.readFile(path.join(sessionsDir, file), 'utf8'));
      } catch (err) {
        // Fichier en cours d'écriture ou supprimé entre-temps : on le signale sans conclure.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          unreadable++;
        }
        continue;
      }
      if (typeof session.pid !== 'number' || typeof session.sessionId !== 'string') {
        unreadable++;
        continue;
      }
      if (!isAlive(session.pid)) {
        continue; // session expirée
      }
      liveIds.add(session.sessionId);
      if (!inScope(session.cwd)) {
        continue; // session d'un autre projet
      }
      const result = await this.sessionSignals(session);
      signals.push(...result.signals);
      delegations.push(...result.delegations);
      subagents.push(...result.subagents);
    }

    for (const key of [...this.agentSettingCache.keys()]) {
      if (!liveIds.has(key)) {
        this.agentSettingCache.delete(key);
        this.sessionDirCache.delete(key);
        this.modelCache.delete(key);
      }
    }

    return {
      health: {
        runtime: 'claude-code',
        status: 'ok',
        message: unreadable ? `${unreadable} unreadable session entr${unreadable > 1 ? 'ies' : 'y'}.` : undefined,
      },
      signals,
      delegations,
      subagents,
    };
  }

  private async sessionSignals(
    session: SessionRecord,
  ): Promise<{ signals: ActivitySignal[]; delegations: Delegation[]; subagents: SubagentRun[] }> {
    const signals: ActivitySignal[] = [];
    const delegations: Delegation[] = [];
    const subagents: SubagentRun[] = [];
    const projectsDir = path.join(this.options.claudeDir, 'projects');
    let sessionDir = this.sessionDirCache.get(session.sessionId);
    if (!sessionDir) {
      sessionDir = await findSessionDir(projectsDir, session);
      if (sessionDir) {
        this.sessionDirCache.set(session.sessionId, sessionDir);
      }
    }

    const named = await this.mainAgent(session, sessionDir);
    // Sans agent nommé, la session est celle de Claude lui-même (une fois le transcript lisible).
    const mainAgent = named ?? (sessionDir ? this.options.defaultAgent : undefined);
    if (mainAgent) {
      const state = session.status === 'busy' ? 'active' : session.status === 'idle' ? 'idle' : 'unknown';
      const model = !named && sessionDir ? await this.model(session.sessionId, sessionDir) : undefined;
      signals.push({
        runtime: 'claude-code',
        agentName: mainAgent,
        state,
        observedAt: session.statusUpdatedAt ?? session.updatedAt ?? this.now(),
        ...(model ? { model } : {}),
      });
    }

    if (sessionDir) {
      const dir = path.join(sessionDir, session.sessionId, 'subagents');
      for (const sub of await this.subagents(dir)) {
        if (sub.signal) {
          signals.push(sub.signal);
          subagents.push({
            id: `${session.sessionId}/${sub.id}`,
            agentType: sub.agentType,
            state: sub.signal.state === 'unknown' ? 'unknown' : 'active',
            startedAt: sub.startedAt,
          });
        }
        if (mainAgent && sub.depth === 1) {
          delegations.push({
            id: `${session.sessionId}/${sub.id}`,
            from: mainAgent,
            to: sub.agentType,
            runtime: 'claude-code',
            startedAt: sub.startedAt,
            finishedAt: sub.finishedAt,
          });
        }
      }
    }
    return { signals, delegations, subagents };
  }

  private async mainAgent(session: SessionRecord, sessionDir: string | undefined): Promise<string | undefined> {
    if (typeof session.agent === 'string' && session.agent) {
      return session.agent;
    }
    const cached = this.agentSettingCache.get(session.sessionId);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    if (!sessionDir) {
      return undefined; // transcript pas encore créé : on réessaiera au prochain cycle
    }
    const setting = await readAgentSetting(path.join(sessionDir, `${session.sessionId}.jsonl`));
    this.agentSettingCache.set(session.sessionId, setting ?? null);
    return setting;
  }

  /** Modèle de la session, relu seulement quand le transcript a changé. */
  private async model(sessionId: string, sessionDir: string): Promise<string | undefined> {
    const transcript = path.join(sessionDir, `${sessionId}.jsonl`);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(transcript)).mtimeMs;
    } catch {
      return undefined;
    }
    const cached = this.modelCache.get(sessionId);
    if (cached?.mtimeMs === mtimeMs) {
      return cached.model;
    }
    const model = await readModel(transcript);
    this.modelCache.set(sessionId, { mtimeMs, model });
    return model;
  }

  private async subagents(dir: string): Promise<SubagentInfo[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const now = this.now();
    const expiry = this.options.subagentExpiryMs ?? 6 * 60 * 60 * 1000;
    const finishedWindow = this.options.finishedWindowMs ?? 10 * 60 * 1000;
    const out: SubagentInfo[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.meta.json')) {
        continue;
      }
      const metaPath = path.join(dir, entry);
      let metaStat: Stats;
      try {
        metaStat = await fs.stat(metaPath);
      } catch {
        continue;
      }
      const cached = this.metaCache.get(metaPath);
      // Un sous-agent terminé depuis longtemps ne change plus : inutile de relire son fichier.
      if (cached?.finished && cached.mtimeMs === metaStat.mtimeMs && now - metaStat.mtimeMs > finishedWindow) {
        continue;
      }
      let meta: { agentType?: unknown; finished?: unknown; spawnDepth?: unknown };
      try {
        meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      } catch {
        continue;
      }
      const finished = meta.finished === true;
      this.metaCache.set(metaPath, { mtimeMs: metaStat.mtimeMs, finished });
      if (typeof meta.agentType !== 'string') {
        continue;
      }
      let transcript: Stats | undefined;
      try {
        transcript = await fs.stat(path.join(dir, entry.replace(/\.meta\.json$/, '.jsonl')));
      } catch {
        transcript = undefined;
      }
      const lastWrite = Math.max(transcript?.mtimeMs ?? 0, finished ? 0 : metaStat.mtimeMs);
      const startedAt = transcript ? transcript.birthtimeMs || transcript.ctimeMs : metaStat.birthtimeMs || lastWrite;
      const id = entry.replace(/\.meta\.json$/, '');
      const depth = typeof meta.spawnDepth === 'number' ? meta.spawnDepth : 1;

      if (finished) {
        if (now - metaStat.mtimeMs <= finishedWindow) {
          out.push({ id, agentType: meta.agentType, depth, startedAt, finishedAt: metaStat.mtimeMs });
        }
        continue;
      }
      const silence = now - lastWrite;
      if (silence > expiry) {
        continue;
      }
      out.push({
        id,
        agentType: meta.agentType,
        depth,
        startedAt,
        signal: {
          runtime: 'claude-code',
          agentName: meta.agentType,
          state: silence > this.options.subagentSilenceMs ? 'unknown' : 'active',
          observedAt: lastWrite,
        },
      });
    }
    return out;
  }
}
