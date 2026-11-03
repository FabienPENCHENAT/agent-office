import * as os from 'os';
import { DEFAULT_AGENT, definitionSources, discoverDefinitions, withDefaultAgent } from '../discovery/agentDefinitions';
import { ClaudeCodeAdapter } from '../runtime/claudeCode';
import { readCopilot } from '../runtime/copilot';
import { winterDecor } from '../state/season';
import { buildSnapshot } from '../state/snapshot';
import { summarize } from '../state/summary';
import { OfficeSnapshot, RuntimeReport } from '../types';
import { OfficeSettings, PanelSettings, panelSettings } from './settings';

/** Ce que la vue affiche après chaque relevé. */
export interface OfficeUpdate {
  snapshot: OfficeSnapshot;
  summary: ReturnType<typeof summarize>;
  christmas: boolean;
  /** Valeurs affichées dans la roue crantée. */
  settings: PanelSettings;
  /** Dossiers dont les sessions sont montrées ; absent, toutes les sessions de la machine. */
  scope?: string[];
}

export interface EngineHost {
  settings(): OfficeSettings;
  /** Dossiers de projet dont le `.claude/agents` est lu (dossiers ouverts dans VS Code, ou choisis dans l'application). */
  projectDirs(): string[];
  onUpdate(update: OfficeUpdate): void;
}

/** Relevé périodique des agents, indépendant de VS Code : partagé par l'extension et l'application Electron. */
export class OfficeEngine {
  /** Dernier relevé, pour le renvoyer à une vue qui s'ouvre. */
  last?: OfficeUpdate;
  /** Fichier .md de chaque agent découvert, par identifiant. Reste côté processus principal. */
  private files = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  private running = false;
  private adapter: ClaudeCodeAdapter;
  private adapterKey = '';

  constructor(private readonly host: EngineHost) {
    this.adapter = this.makeAdapter();
  }

  private key(c: OfficeSettings): string {
    return `${c.claudeDir}|${c.silenceMs}|${c.showClaude}`;
  }

  private makeAdapter(): ClaudeCodeAdapter {
    const c = this.host.settings();
    this.adapterKey = this.key(c);
    return new ClaudeCodeAdapter({
      claudeDir: c.claudeDir,
      subagentSilenceMs: c.silenceMs,
      defaultAgent: c.showClaude ? DEFAULT_AGENT : undefined,
    });
  }

  /** Fichier de définition d'un agent découvert ; seul un fichier découvert peut être ouvert. */
  fileOf(id: unknown): string | undefined {
    return typeof id === 'string' ? this.files.get(id) : undefined;
  }

  start(): void {
    this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.host.settings().pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  onSettingsChanged(): void {
    if (this.key(this.host.settings()) !== this.adapterKey) {
      this.adapter = this.makeAdapter();
    }
    this.start();
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const c = this.host.settings();
      const dirs = this.host.projectDirs();
      const discovery = await discoverDefinitions(definitionSources(c.claudeDir, os.homedir(), dirs));
      this.files = new Map(discovery.definitions.flatMap((d) => (d.file ? [[d.id, d.file] as const] : [])));
      // Sans dossier de projet, rien ne permet de filtrer : toutes les sessions sont montrées.
      const scope = c.sessionScope === 'project' && dirs.length ? dirs : undefined;
      let claude: RuntimeReport;
      try {
        claude = await this.adapter.read(scope);
      } catch (err) {
        claude = { health: { runtime: 'claude-code', status: 'unavailable', message: String(err) }, signals: [] };
      }
      const notices = discovery.errors.map((e) => `Unreadable agents folder: ${e.dir} (${e.message})`);
      const definitions = c.showClaude ? withDefaultAgent(discovery.definitions) : discovery.definitions;
      const snapshot = buildSnapshot(definitions, [claude, readCopilot()], Date.now(), {
        pinned: c.pinned,
        rooms: c.rooms,
        notices,
      });
      // Réévalué à chaque relevé : le décor apparaît et disparaît seul aux dates prévues.
      this.last = {
        snapshot,
        summary: summarize(snapshot),
        christmas: winterDecor(c.seasonal, new Date()),
        settings: panelSettings(c),
        scope,
      };
      this.host.onUpdate(this.last);
    } finally {
      this.running = false;
    }
  }
}
