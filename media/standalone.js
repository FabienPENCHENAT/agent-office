// @ts-check
// Application Electron : la page d'office parle comme dans une Webview VS Code. Ce script fournit
// `acquireVsCodeApi`, rejoue sur `window` les messages du processus principal, et ajoute la barre du
// répertoire de travail (liste des répertoires récents, changement de répertoire, nouvelle fenêtre).
(() => {
  const host = /** @type {any} */ (window).agentOfficeHost;
  /** @type {any} */ (window).acquireVsCodeApi = () => ({
    postMessage: (/** @type {unknown} */ msg) => host.send(msg),
  });
  host.onMessage((/** @type {unknown} */ msg) => window.postMessage(msg, '*'));

  const el = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {string} */ text = '') => {
    const node = document.createElement(tag);
    node.className = cls;
    node.textContent = text;
    return node;
  };
  const button = (/** @type {string} */ cls, /** @type {string} */ text, /** @type {string} */ title, /** @type {() => void} */ onClick) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', cls, text));
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  const send = (/** @type {object} */ msg) => host.send(msg);

  const bar = el('div', 'folderbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Working folder');
  const menu = /** @type {HTMLDetailsElement} */ (el('details', 'fb-menu'));
  const summary = el('summary', 'fb-summary');
  const name = el('span', 'fb-name', 'No folder');
  summary.append(el('span', 'fb-label', 'Folder'), name, el('span', 'fb-caret', '▾'));
  const list = el('ul', 'fb-list');
  menu.append(summary, list);
  const hint = el('span', 'fb-hint', 'Pick a folder to see its project agents.');
  // Ouvre le panneau des réglages de media/office.js, comme le bouton ⚙ de la vue dans VS Code.
  const settings = button('fb-btn fb-settings', '⚙\uFE0E', 'Office settings', () => window.postMessage({ type: 'toggleSettings' }, '*'));
  settings.dataset.settingsToggle = '';
  settings.setAttribute('aria-label', 'Office settings');
  bar.append(
    menu,
    button('fb-btn', 'Open folder…', 'Use another working folder in this window', () => send({ type: 'chooseFolder' })),
    button('fb-btn', 'New window…', 'Open another folder in a new window', () => send({ type: 'newWindow' })),
    hint,
    settings,
  );
  document.body.prepend(bar);

  // Le panneau se ferme quand on clique ailleurs ou sur Échap.
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(/** @type {Node} */ (e.target))) {
      menu.open = false;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      summary.focus();
    }
  });

  /** @param {{ current: string | null, recents: { path: string, name: string }[] }} msg */
  function showFolders(msg) {
    name.textContent = msg.current ? msg.current.split(/[\\/]/).filter(Boolean).pop() || msg.current : 'No folder';
    summary.title = msg.current || 'No working folder selected';
    hint.hidden = !!msg.current;
    list.replaceChildren(
      ...(msg.recents.length
        ? msg.recents.map((r) => {
            const li = el('li', r.path === msg.current ? 'fb-item is-current' : 'fb-item');
            const pick = button('fb-pick', '', r.path, () => {
              menu.open = false;
              if (r.path !== msg.current) {
                send({ type: 'switchFolder', path: r.path });
              }
            });
            pick.append(el('span', 'fb-pick-name', r.name), el('span', 'fb-pick-path', r.path));
            li.append(
              pick,
              button('fb-icon', '⧉', `Open ${r.name} in a new window`, () => {
                menu.open = false;
                send({ type: 'newWindow', path: r.path });
              }),
              button('fb-icon', '✕', `Remove ${r.name} from the list (the folder is not deleted)`, () =>
                send({ type: 'removeRecent', path: r.path }),
              ),
            );
            return li;
          })
        : [el('li', 'fb-empty', 'No recent folder')]),
    );
  }

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'folders') {
      showFolders(event.data);
    }
  });
})();
