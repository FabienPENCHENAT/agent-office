import * as os from 'os';
import { DEFAULT_AGENT, definitionSources, discoverDefinitions, withDefaultAgent } from '../discovery/agentDefinitions';
import { ClaudeCodeAdapter } from '../runtime/claudeCode';
import { readCopilot } from '../runtime/copilot';
import { winterDecor } from '../state/season';
import { withoutDismissed } from '../state/dismiss';
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
  /** Relevé demandé pendant qu'un autre était en cours (dossier changé, par exemple) : refait juste après. */
  private again = false;
  private adapter: ClaudeCodeAdapter;
  private adapterKey = '';
  /** Instances de sous-agents retirées du bureau par l'utilisateur, tant qu'elles restent dans le relevé. */
  private dismissed = new Set<string>();
  /** Instances du dernier relevé qui n'attendent pas l'utilisateur : seules celles-ci peuvent être retirées. */
  private dismissable = new Set<string>();

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

  /**
   * Retire du bureau des instances de sous-agents, quand l'utilisateur le décide. La vue ne donne que des
   * identifiants : seule une instance du dernier relevé qui n'attend pas l'utilisateur est acceptée. Claude Code
   * n'est pas touché.
   */
  dismiss(ids: unknown): Promise<void> {
    const accepted = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && this.dismissable.has(id)) : [];
    if (!accepted.length) {
      return Promise.resolve();
    }
    accepted.forEach((id) => this.dismissed.add(id));
    return this.tick();
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
      this.again = true;
      return;
    }
    this.running = true;
    this.again = false;
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
      // Une instance retirée qui n'est plus dans le relevé (terminée ou expirée) est oubliée.
      const runs = claude.subagents ?? [];
      const live = new Set(runs.map((r) => r.id));
      this.dismissed = new Set([...this.dismissed].filter((id) => live.has(id)));
      this.dismissable = new Set(runs.filter((r) => r.state !== 'waiting').map((r) => r.id));
      claude = withoutDismissed(claude, this.dismissed);
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
    if (this.again) {
      await this.tick();
    }
  }
}
