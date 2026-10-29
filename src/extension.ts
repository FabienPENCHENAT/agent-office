import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { definitionSources, discoverDefinitions } from './discovery/agentDefinitions';
import { ClaudeCodeAdapter } from './runtime/claudeCode';
import { readCopilot } from './runtime/copilot';
import { buildSnapshot } from './state/snapshot';
import { summarize } from './state/summary';
import { OfficeSnapshot, RuntimeReport } from './types';
import { officeHtml } from './view/officeHtml';

type ReduceMotion = 'on' | 'off' | 'auto';

function config() {
  const c = vscode.workspace.getConfiguration('agentOffice');
  const claudeDir =
    c.get<string>('claudeConfigDir')?.trim() || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return {
    claudeDir,
    pollMs: Math.max(1, c.get<number>('pollIntervalSeconds', 2)) * 1000,
    silenceMs: Math.max(1, c.get<number>('subagentSilenceMinutes', 20)) * 60_000,
    pinned: c.get<string[]>('pinnedAgents', []),
    rooms: c.get<Record<string, string>>('agentRooms', {}),
  };
}

function reduceMotion(): ReduceMotion {
  const value = vscode.workspace.getConfiguration('workbench').get<string>('reduceMotion', 'auto');
  return value === 'on' || value === 'off' ? value : 'auto';
}

class OfficeController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private snapshot?: OfficeSnapshot;
  private timer?: NodeJS.Timeout;
  private running = false;
  private adapter: ClaudeCodeAdapter;
  private adapterKey = '';
  private readonly statusBar: vscode.StatusBarItem;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly version: string,
  ) {
    this.adapter = this.makeAdapter();
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBar.command = 'agentOffice.show';
    this.statusBar.name = 'Agent Office';
    this.statusBar.show();
  }

  private makeAdapter(): ClaudeCodeAdapter {
    const c = config();
    this.adapterKey = `${c.claudeDir}|${c.silenceMs}`;
    return new ClaudeCodeAdapter({ claudeDir: c.claudeDir, subagentSilenceMs: c.silenceMs });
  }

  start(): void {
    this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config().pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  onConfigChanged(): void {
    const c = config();
    if (`${c.claudeDir}|${c.silenceMs}` !== this.adapterKey) {
      this.adapter = this.makeAdapter();
    }
    this.start();
    this.postMotion();
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const c = config();
      const workspaceDirs = (vscode.workspace.workspaceFolders ?? [])
        .filter((f) => f.uri.scheme === 'file')
        .map((f) => f.uri.fsPath);
      const discovery = await discoverDefinitions(definitionSources(c.claudeDir, os.homedir(), workspaceDirs));
      let claude: RuntimeReport;
      try {
        claude = await this.adapter.read();
      } catch (err) {
        claude = { health: { runtime: 'claude-code', status: 'unavailable', message: String(err) }, signals: [] };
      }
      const notices = discovery.errors.map((e) => `Unreadable agents folder: ${e.dir} (${e.message})`);
      this.snapshot = buildSnapshot(discovery.definitions, [claude, readCopilot()], Date.now(), {
        pinned: c.pinned,
        rooms: c.rooms,
        notices,
      });
      this.render();
    } finally {
      this.running = false;
    }
  }

  private render(): void {
    if (!this.snapshot) {
      return;
    }
    const summary = summarize(this.snapshot);
    const icon = { active: '$(pulse)', idle: '$(circle-outline)', unknown: '$(question)', empty: '$(circle-slash)' }[
      summary.kind
    ];
    this.statusBar.text = `${icon} ${summary.text}`;
    this.statusBar.tooltip = 'Agent Office — which agent is working right now? (click to open the office)';
    void this.view?.webview.postMessage({ type: 'snapshot', snapshot: this.snapshot, summary });
  }

  private postMotion(): void {
    void this.view?.webview.postMessage({ type: 'motion', reduceMotion: reduceMotion() });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = officeHtml(view.webview, this.extensionUri, this.version);
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        this.postMotion();
        this.render();
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  dispose(): void {
    this.stop();
    this.statusBar.dispose();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new OfficeController(context.extensionUri, String(context.extension.packageJSON.version ?? '0'));
  context.subscriptions.push(
    controller,
    vscode.window.registerWebviewViewProvider('agentOffice.office', controller, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('agentOffice.show', () =>
      vscode.commands.executeCommand('workbench.view.extension.agentOffice'),
    ),
    vscode.commands.registerCommand('agentOffice.refresh', () => controller.tick()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentOffice') || e.affectsConfiguration('workbench.reduceMotion')) {
        controller.onConfigChanged();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void controller.tick()),
  );
  controller.start();
}

export function deactivate(): void {
  // Les ressources sont libérées via context.subscriptions.
}
