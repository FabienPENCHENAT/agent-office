export interface OfficePageOptions {
  csp: string;
  styles: string[];
  scripts: string[];
  /** Nonce des balises script, quand la CSP en exige un. */
  nonce?: string;
}

/** Corps de la page de l'office, commun à la Webview VS Code et à la fenêtre de l'application Electron. */
export function officePage(o: OfficePageOptions): string {
  const nonce = o.nonce ? ` nonce="${o.nonce}"` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${o.csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${o.styles.map((href) => `  <link rel="stylesheet" href="${href}">`).join('\n')}
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
${o.scripts.map((src) => `  <script${nonce} src="${src}"></script>`).join('\n')}
</body>
</html>`;
}
