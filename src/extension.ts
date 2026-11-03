import * as vscode from 'vscode';
import { OfficeEngine, OfficeUpdate } from './core/engine';
import { OfficeSettings, resolveSettings } from './core/settings';
import { officeHtml } from './view/officeHtml';

type ReduceMotion = 'on' | 'off' | 'auto';

function config(): OfficeSettings {
  return resolveSettings(vscode.workspace.getConfiguration('agentOffice') as unknown as Record<string, unknown>);
}

function reduceMotion(): ReduceMotion {
  const value = vscode.workspace.getConfiguration('workbench').get<string>('reduceMotion', 'auto');
  return value === 'on' || value === 'off' ? value : 'auto';
}

class OfficeController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly engine: OfficeEngine;
  private readonly statusBar: vscode.StatusBarItem;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly version: string,
  ) {
    this.engine = new OfficeEngine({
      settings: config,
      projectDirs: () =>
        (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath),
      onUpdate: (update) => this.render(update),
    });
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBar.command = 'agentOffice.show';
    this.statusBar.name = 'Agent Office';
    this.statusBar.show();
  }

  start(): void {
    this.engine.start();
  }

  tick(): Promise<void> {
    return this.engine.tick();
  }

  onConfigChanged(): void {
    this.engine.onSettingsChanged();
    this.postMotion();
  }

  private render(update: OfficeUpdate | undefined = this.engine.last): void {
    if (!update) {
      return;
    }
    const icon = { active: '$(pulse)', idle: '$(circle-outline)', unknown: '$(question)', empty: '$(circle-slash)' }[
      update.summary.kind
    ];
    this.statusBar.text = `${icon} ${update.summary.text}`;
    this.statusBar.tooltip = 'Agent Office — which agent is working right now? (click to open the office)';
    void this.view?.webview.postMessage({ type: 'snapshot', ...update });
  }

  /** Ouvre la définition d'un agent. La vue ne donne qu'un identifiant : seul un fichier découvert peut être ouvert. */
  private async openAgent(id: unknown): Promise<void> {
    const file = this.engine.fileOf(id);
    if (!file) {
      return;
    }
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
    } catch (err) {
      void vscode.window.showErrorMessage(`Agent Office: cannot open ${file} (${String(err)})`);
    }
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
      } else if (msg?.type === 'openAgent') {
        void this.openAgent(msg.id);
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  dispose(): void {
    this.engine.stop();
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
