import * as vscode from 'vscode';
import { OfficeEngine, OfficeUpdate } from './core/engine';
import { OfficeSettings, panelSetting, resolveSettings } from './core/settings';
import { officeHtml } from './view/officeHtml';

type ReduceMotion = 'on' | 'off' | 'auto';

function config(): OfficeSettings {
  const conf = vscode.workspace.getConfiguration('agentOffice');
  const raw: Record<string, unknown> = { ...(conf as unknown as Record<string, unknown>) };
  // VS Code donne toujours la valeur par défaut : sans `seasonalDecor` défini, l'ancien `christmasDecor: "off"` compte.
  const seasonal = conf.inspect('seasonalDecor');
  if ([seasonal?.globalValue, seasonal?.workspaceValue, seasonal?.workspaceFolderValue].every((v) => v === undefined)) {
    delete raw.seasonalDecor;
  }
  return resolveSettings(raw);
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

  /**
   * Enregistre un réglage changé dans la roue crantée de l'office. Il est écrit là où il est déjà défini
   * (dossier ou espace de travail), sinon dans les réglages de l'utilisateur.
   */
  private async setSetting(key: unknown, value: unknown): Promise<void> {
    const setting = panelSetting(key, value);
    if (!setting) {
      return;
    }
    const conf = vscode.workspace.getConfiguration('agentOffice');
    const where = conf.inspect(setting.key);
    const target =
      where?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : where?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
    try {
      await conf.update(setting.key, setting.value, target);
    } catch (err) {
      void vscode.window.showErrorMessage(`Agent Office: cannot save ${setting.key} (${String(err)})`);
    }
  }

  /** Ouvre ou ferme le panneau des réglages de l'office (bouton ⚙ de la barre de titre de la vue). */
  async toggleSettings(): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand('agentOffice.office.focus');
    }
    void this.view?.webview.postMessage({ type: 'toggleSettings' });
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
      } else if (msg?.type === 'setSetting') {
        void this.setSetting(msg.key, msg.value);
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
    vscode.commands.registerCommand('agentOffice.settings', () => controller.toggleSettings()),
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
