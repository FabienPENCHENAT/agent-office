import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { officePage } from './officePage';

/** Page de la Webview : ressources locales uniquement, CSP sans réseau, script à nonce. */
export function officeHtml(webview: vscode.Webview, extensionUri: vscode.Uri, version: string): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  // Le paramètre de version empêche la Webview de resservir un script ou une feuille de style d'une version précédente.
  const media = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).with({ query: `v=${version}` }).toString();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return officePage({
    csp,
    styles: [media('office.css')],
    scripts: [media('office.js')],
    nonce,
  });
}
