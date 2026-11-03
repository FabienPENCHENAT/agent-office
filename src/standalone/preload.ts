import { contextBridge, ipcRenderer } from 'electron';

/**
 * Pont entre la page de l'office et le processus principal. La page parle le même protocole que dans VS Code
 * (`ready`, `openAgent`, `setSetting` ; `snapshot`, `motion`) : media/standalone.js en fait un `acquireVsCodeApi`.
 */
contextBridge.exposeInMainWorld('agentOfficeHost', {
  send: (msg: unknown) => ipcRenderer.send('office:message', msg),
  onMessage: (callback: (msg: unknown) => void) => {
    ipcRenderer.on('office:message', (_event, msg: unknown) => callback(msg));
  },
});
