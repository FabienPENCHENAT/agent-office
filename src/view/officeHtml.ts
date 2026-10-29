import * as crypto from 'crypto';
import * as vscode from 'vscode';

/** Page de la Webview : ressources locales uniquement, CSP sans réseau, script à nonce. */
export function officeHtml(webview: vscode.Webview, extensionUri: vscode.Uri, version: string): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  // Le paramètre de version empêche la Webview de resservir un script ou une feuille de style d'une version précédente.
  const media = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).with({ query: `v=${version}` });
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('office.css')}">
  <title>Agent Office</title>
</head>
<body>
  <header id="banner" class="banner banner--unknown" role="status" aria-live="polite">
    <span class="banner__dot" aria-hidden="true"></span>
    <span id="banner-text">Reading agent status…</span>
  </header>
  <main class="stage">
    <canvas id="office" width="368" height="208" aria-hidden="true"></canvas>
  </main>
  <ul id="roster" class="roster" aria-label="Agent desks"></ul>
  <footer id="footer" class="footer"></footer>
  <script nonce="${nonce}" src="${media('office.js')}"></script>
</body>
</html>`;
}
