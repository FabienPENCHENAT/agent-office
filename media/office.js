// @ts-check
// Rendu du bureau. Ce script ne reçoit que des noms, des états, des postes et des horodatages de délégation.
//
// Ce qui est réel : l'état actif / inactif / inconnu, et les délégations (lancement et fin d'un sous-agent).
//  - Un agent actif rejoint son poste et travaille.
//  - Une délégation qui démarre se traduit par une visite (un seul agent) ou une réunion (plusieurs).
//  - Une délégation terminée se traduit par une remise de copie au délégant.
// Ce qui est décoratif : le cycle de vie des agents inactifs (hamac, banc et bord du lac, discussions, promenades).
(function () {
  'use strict';

  /** @type {any} */
  const vscode = /** @type {any} */ (window).acquireVsCodeApi();

  // ======================================================================
  // Plan du bureau (en cases de 8 px)
  // ======================================================================
  const T = 8;
  const COLS = 46;
  const ROWS = 26;
  const W = COLS * T;
  const H = ROWS * T;

  /** @typedef {{x:number,y:number}} Tile */
  /** @typedef {{x:number,y:number,w:number,h:number}} Rect */
  /** @typedef {'up'|'down'|'left'|'right'} Dir */

  // En haut : trois bureaux individuels et la petite salle. En bas : la grande salle (face au bureau du PM),
  // l'open space et le coin détente.
  const ROOMS = {
    pm: { x0: 0, x1: 11, y0: 3, y1: 9, door: 5, label: 'Product manager', floor: 'parquet' },
    challenger: { x0: 13, x1: 23, y0: 3, y1: 9, door: 18, label: 'Challenger', floor: 'parquet' },
    design: { x0: 25, x1: 35, y0: 3, y1: 9, door: 30, label: 'UX/UI design', floor: 'parquet' },
    small: { x0: 37, x1: 45, y0: 3, y1: 9, door: 40, label: 'Small meeting room', floor: 'tiles' },
    big: { x0: 0, x1: 11, y0: 14, y1: 25, door: 5, label: 'Large meeting room', floor: 'tiles' },
    open: { x0: 13, x1: 30, y0: 13, y1: 25, label: 'Engineering open space', floor: 'bricks' },
    lounge: { x0: 31, x1: 45, y0: 13, y1: 25, label: 'Lounge', floor: 'grass' },
  };
  /** Mur côté couloir des pièces du haut, puis couloir. */
  const TOP_WALL = ROOMS.pm.y1 + 1;
  const CORRIDOR = { y0: TOP_WALL + 1, y1: TOP_WALL + 2 };

  const blocked = new Uint8Array(COLS * ROWS);
  const block = (/** @type {Rect} */ r) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS) {
          blocked[y * COLS + x] = 1;
        }
      }
    }
  };
  const free = (/** @type {number} */ x, /** @type {number} */ y) =>
    x >= 0 && y >= 0 && x < COLS && y < ROWS && !blocked[y * COLS + x];

  // Murs : façade, cloisons entre pièces, mur côté couloir percé d'une porte par pièce.
  block({ x: 0, y: 0, w: COLS, h: 3 });
  const PARTITIONS = [12, 24, 36];
  for (const c of PARTITIONS) {
    block({ x: c, y: 3, w: 1, h: TOP_WALL - 3 });
  }
  const doors = [ROOMS.pm, ROOMS.challenger, ROOMS.design, ROOMS.small].map((r) => r.door);
  for (let x = 0; x < COLS; x++) {
    if (!doors.some((d) => x === d || x === d + 1)) {
      block({ x, y: TOP_WALL, w: 1, h: 1 });
    }
  }
  // Grande salle : mur côté couloir (porte face au bureau du PM) et cloison avec l'open space.
  const BIG_WALL = ROOMS.big.y0 - 1;
  const BIG_PARTITION = ROOMS.big.x1 + 1;
  for (let x = 0; x <= ROOMS.big.x1; x++) {
    if (x !== ROOMS.big.door && x !== ROOMS.big.door + 1) {
      block({ x, y: BIG_WALL, w: 1, h: 1 });
    }
  }
  block({ x: BIG_PARTITION, y: BIG_WALL, w: 1, h: ROWS - BIG_WALL });

  /**
   * Postes de travail. `seat` : chaise ; `visitor` : où l'on vient le voir ; `dir` : orientation de l'agent assis.
   *  - bureaux individuels : fauteuil côté mur, à l'opposé de la porte ; l'agent fait face à la scène ;
   *  - open space : l'agent est de dos, face à son écran.
   */
  /** @type {Record<string, {desk:Rect, seat:Tile, visitor:Tile, kind:string, n:number, dir:Dir}>} */
  const STATIONS = {};
  [['office-pm', ROOMS.pm], ['office-challenger', ROOMS.challenger], ['office-design', ROOMS.design]].forEach(([id, room], n) => {
    const ox = /** @type {any} */ (room).x0;
    STATIONS[/** @type {string} */ (id)] = {
      desk: { x: ox + 4, y: 6, w: 4, h: 2 },
      seat: { x: ox + 6, y: 5 },
      visitor: { x: ox + 8, y: 5 },
      kind: 'office',
      n,
      dir: 'down',
    };
    block({ x: ox + 9, y: 3, w: 2, h: 1 }); // bibliothèque
    block({ x: ox, y: 3, w: 1, h: 1 }); // plante
  });
  [[14, 14], [20, 14], [26, 14], [14, 18], [20, 18], [26, 18], [20, 22]].forEach(([c, r], i) => {
    STATIONS[`open-${i + 1}`] = {
      desk: { x: c, y: r, w: 4, h: 2 },
      seat: { x: c + 2, y: r + 2 },
      visitor: { x: c + 4, y: r + 2 },
      kind: 'open',
      n: i,
      dir: 'up',
    };
  });
  for (const s of Object.values(STATIONS)) {
    block(s.desk);
  }

  /** Salles de réunion : table, place du délégant (tête de table) et sièges. */
  const MEETING = {
    small: {
      // Remontée d'une case : on peut passer entre les sièges du bas et la porte.
      table: { x: 39, y: 5, w: 5, h: 3 },
      head: { x: 38, y: 6 },
      seats: [{ x: 39, y: 4 }, { x: 41, y: 4 }, { x: 43, y: 4 }, { x: 39, y: 8 }, { x: 41, y: 8 }, { x: 43, y: 8 }, { x: 44, y: 6 }],
      busy: /** @type {any} */ (null),
    },
    big: {
      // Descendue d'une case : plus d'espace entre la porte et la tête de table.
      table: { x: 4, y: 17, w: 3, h: 7 },
      head: { x: 5, y: 16 },
      seats: [17, 19, 21, 23].flatMap((y) => [{ x: 3, y }, { x: 7, y }]).concat([{ x: 5, y: 24 }]),
      busy: /** @type {any} */ (null),
    },
  };
  /** Plantes de la grande salle. */
  const BIG_PLANTS = [{ x: 0, y: 14 }, { x: 11, y: 14 }, { x: 0, y: 25 }, { x: 11, y: 25 }];
  for (const p of BIG_PLANTS) {
    block({ x: p.x, y: p.y, w: 1, h: 1 });
  }
  block(MEETING.small.table);
  block(MEETING.big.table);
  /** Orientation d'un siège autour d'une table. */
  const seatDir = (/** @type {Tile} */ s, /** @type {Rect} */ t) =>
    /** @type {Dir} */ (s.y < t.y ? 'down' : s.y >= t.y + t.h ? 'up' : s.x < t.x ? 'right' : 'left');
  /** Sièges latéraux : la personne assise passe devant la table (profondeur = bas de la table). */
  const sideSeatBase = new Map();
  for (const m of Object.values(MEETING)) {
    for (const s of [m.head, ...m.seats]) {
      const d = seatDir(s, m.table);
      if (d === 'left' || d === 'right') {
        sideSeatBase.set(`${s.x},${s.y}`, (m.table.y + m.table.h) * T);
      }
    }
  }

  // Coin détente « nature » : un petit lac et son banc, un petit bois avec un hamac. Peu d'objets, beaucoup de verdure.
  const LOUNGE = {
    pond: { x: 39, y: 14, w: 6, h: 4 },
    log: { y: 18, seats: [40, 42], blocks: [39, 41, 43] },
    trees: [{ x: 32, y: 21 }, { x: 40, y: 21 }, { x: 43, y: 21 }, { x: 35, y: 23 }],
    hammock: { x: 42, y: 22 },
    bushes: [{ x: 45, y: 19 }, { x: 31, y: 25 }],
  };
  block(LOUNGE.pond);
  for (const x of LOUNGE.log.blocks) {
    block({ x, y: LOUNGE.log.y, w: 1, h: 1 });
  }
  for (const t of LOUNGE.trees) {
    block({ x: t.x, y: t.y, w: 2, h: 2 });
  }
  for (const p of LOUNGE.bushes) {
    block({ x: p.x, y: p.y, w: 1, h: 1 });
  }

  /** Lieux de détente (décoratifs). */
  const SPOTS = [
    ...LOUNGE.log.seats.map((x) => ({ key: `log${x}`, tile: { x, y: LOUNGE.log.y }, pose: 'sit', dir: 'up', bubble: null, kind: 'pond' })),
    { key: 'pondside', tile: { x: LOUNGE.pond.x - 1, y: LOUNGE.pond.y + 2 }, pose: 'stand', dir: 'right', bubble: null, kind: 'pond' },
    { key: 'hammock', tile: LOUNGE.hammock, pose: 'sit', dir: 'down', bubble: 'zzz', kind: 'relax' },
  ];

  /** Corbeilles et plantes de l'open space. */
  const BINS = [[13, 25], [30, 25]];
  const OPEN_PLANTS = [{ x: 13, y: 13 }, { x: 30, y: 13 }];
  for (const [x, y] of BINS) {
    block({ x, y, w: 1, h: 1 });
  }
  for (const p of OPEN_PLANTS) {
    block({ x: p.x, y: p.y, w: 1, h: 1 });
  }

  const seatKeys = new Set(Object.values(STATIONS).map((s) => `${s.seat.x},${s.seat.y}`));
  const officeSeatKeys = new Set(Object.values(STATIONS).filter((s) => s.kind === 'office').map((s) => `${s.seat.x},${s.seat.y}`));
  const inBigRoom = (/** @type {number} */ x, /** @type {number} */ y) => x <= ROOMS.big.x1 && y >= BIG_WALL;
  /** Cases de promenade : couloir, open space (hors chaises), détente ; jamais la grande salle. */
  const WANDER = [];
  for (let y = CORRIDOR.y0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (free(x, y) && !seatKeys.has(`${x},${y}`) && !inBigRoom(x, y)) {
        WANDER.push({ x, y });
      }
    }
  }

  const feet = (/** @type {Tile} */ t) => ({ x: t.x * T + 4, y: t.y * T + 7 });
  const tileOf = (/** @type {{x:number,y:number}} */ p) => ({ x: Math.round((p.x - 4) / T), y: Math.round((p.y - 7) / T) });

  /** Plus court chemin (BFS 4 directions) entre deux cases. */
  function findPath(/** @type {Tile} */ from, /** @type {Tile} */ to) {
    if (from.x === to.x && from.y === to.y) {
      return [];
    }
    const prev = new Int32Array(COLS * ROWS).fill(-1);
    const start = from.y * COLS + from.x;
    const goal = to.y * COLS + to.x;
    const queue = [start];
    prev[start] = start;
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (cur === goal) {
        break;
      }
      const cx = cur % COLS;
      const cy = (cur - cx) / COLS;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
          continue;
        }
        const ni = ny * COLS + nx;
        if ((free(nx, ny) || ni === goal) && prev[ni] === -1) {
          prev[ni] = cur;
          queue.push(ni);
        }
      }
    }
    if (prev[goal] === -1) {
      return [feet(to)];
    }
    const out = [];
    for (let c = goal; c !== start; c = prev[c]) {
      out.push(feet({ x: c % COLS, y: Math.floor(c / COLS) }));
    }
    return out.reverse();
  }

  // ======================================================================
  // État
  // ======================================================================
  const PALETTE = {
    green: '#4fb06a', cyan: '#35b3c9', yellow: '#f2c03a', orange: '#f08a3c', purple: '#9b68d9',
    red: '#e2504f', blue: '#3f7fe0', pink: '#ec6fae', gray: '#8a93a6', grey: '#8a93a6', white: '#eef0f4',
  };
  const FALLBACK = ['#3f7fe0', '#4fb06a', '#f08a3c', '#9b68d9', '#35b3c9', '#e2504f', '#f2c03a', '#ec6fae', '#5fc4a4', '#c9784f'];
  /** Couleur déclarée (`color:` nommée ou #rrggbb), sinon null. */
  const declaredColor = (/** @type {any} */ c) => {
    const v = String(c || '').trim().toLowerCase();
    return PALETTE[v] || (/^#[0-9a-f]{6}$/.test(v) ? v : null);
  };
  /**
   * Couleurs des agents représentés : la couleur déclarée si elle existe, sinon la première couleur
   * de secours qu'aucun autre agent n'utilise encore (pas deux agents sans couleur de la même teinte).
   */
  function assignColors(/** @type {any[]} */ slots) {
    const used = new Set(slots.map((s) => declaredColor(s.agent && s.agent.color)).filter(Boolean));
    const colors = new Map();
    for (const s of slots) {
      if (!s.agent) {
        continue;
      }
      let c = declaredColor(s.agent.color);
      if (!c) {
        c = FALLBACK.find((f) => !used.has(f)) || FALLBACK[colors.size % FALLBACK.length];
        used.add(c);
      }
      colors.set(s.agent.id, c);
    }
    return colors;
  }
  const SKINS = ['#ffd8b8', '#f2be92', '#d99a6c', '#b97a4e', '#8d5a3a', '#ffe0c8', '#e9ad82', '#c68a5f'];
  const HAIRS = ['#4a2f22', '#2b2236', '#8a4b22', '#e0a73c', '#6b3a2a', '#3b3f6b', '#c4512f', '#b5793a', '#2f5b8f', '#7a4a8f'];

  /** @type {any} */
  let snapshot = null;
  let reduceMotionSetting = 'auto';
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceMotionSetting === 'on' || (reduceMotionSetting === 'auto' && mq.matches);

  /** @type {Map<string, any>} personnages par identifiant d'agent */
  const people = new Map();
  /** @type {Map<string, string>} lieu de détente → agent qui l'occupe */
  const spotTaken = new Map();
  const seenStart = new Set();
  const seenFinish = new Set();
  /** @type {Map<string, {targets:Set<string>, at:number}>} briefs en attente de regroupement */
  const pendingBriefs = new Map();
  let clock = 0;

  const byName = (/** @type {string} */ name) => [...people.values()].find((p) => p.name === name);
  const station = (/** @type {any} */ p) => STATIONS[p.ws];
  const atTile = (/** @type {any} */ p, /** @type {Tile} */ t) => {
    const f = feet(t);
    return Math.abs(p.x - f.x) < 0.5 && Math.abs(p.y - f.y) < 0.5;
  };

  // ======================================================================
  // DOM
  // ======================================================================
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('office'));
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const stage = /** @type {HTMLElement} */ (document.querySelector('.stage'));
  const scene = document.createElement('div');
  scene.className = 'scene';
  stage.appendChild(scene);
  scene.appendChild(canvas);

  // La scène occupe toute la largeur du panneau.
  function layout() {
    const w = Math.max(240, stage.clientWidth);
    scene.style.width = `${w}px`;
    scene.style.height = `${(w * H) / W}px`;
  }
  new ResizeObserver(layout).observe(stage);
  layout();

  // ======================================================================
  // Utilitaires
  // ======================================================================
  const fmtTime = (/** @type {number|undefined} */ t) =>
    t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const stateLabel = (/** @type {string} */ s) => ({ active: 'working', inactive: 'idle', unknown: 'unknown' })[s] || s;
  const rand = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.random() * (b - a);
  const pick = (/** @type {any[]} */ list) => list[Math.floor(Math.random() * list.length)];
  function hash(/** @type {string} */ str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  }

  // ======================================================================
  // Tâches des personnages
  // ======================================================================
  // go : se rendre sur une case ; wait : patienter (avec bulle) ; until : attendre une condition ; call : effet.
  // Les tâches « scripted » viennent d'un signal réel (délégation) : le cycle de vie ne les annule pas.
  const go = (/** @type {Tile} */ tile, /** @type {string} */ pose, /** @type {Dir=} */ dir) => ({ k: 'go', tile, pose, dir });
  const wait = (/** @type {number} */ t, /** @type {string|null} */ bubble, /** @type {any} */ opts = {}) => ({ k: 'wait', t, bubble, ...opts });
  const until = (/** @type {() => boolean} */ fn, /** @type {number} */ timeout) => ({ k: 'until', fn, timeout });
  const call = (/** @type {() => void} */ fn) => ({ k: 'call', fn });
  const scripted = (/** @type {any[]} */ tasks) => tasks.map((t) => ({ ...t, scripted: true }));
  /** Activité affichée en bulle au-dessus de la tête tant qu'aucune bulle ponctuelle ne la masque. */
  const doing = (/** @type {any} */ p, /** @type {string|null} */ activity) => call(() => {
    p.activity = activity;
  });

  function releaseSpot(/** @type {any} */ p) {
    for (const [k, v] of spotTaken) {
      if (v === p.id) {
        spotTaken.delete(k);
      }
    }
  }

  /** Annule le cycle de vie décoratif d'un personnage (jamais les tâches issues d'un signal réel). */
  function clearLife(/** @type {any} */ p) {
    p.tasks = p.tasks.filter((/** @type {any} */ t) => t.scripted);
    if (p.cur && !p.cur.scripted) {
      p.cur = null;
      p.path = [];
      p.bubble = null;
    }
    if (p.pair) {
      p.pair.cancelled = true;
      p.pair = null;
    }
    releaseSpot(p);
  }

  function startTask(/** @type {any} */ p, /** @type {any} */ task) {
    if (task.k === 'go') {
      p.path = findPath(tileOf(p), task.tile);
    }
  }

  /** Avance la tâche courante. Retourne true quand elle est terminée. */
  function runTask(/** @type {any} */ p, /** @type {any} */ task, /** @type {number} */ dt) {
    switch (task.k) {
      case 'go':
        if (p.path.length) {
          walk(p, dt);
          return false;
        }
        p.pose = task.pose;
        if (task.dir) {
          p.dir = task.dir;
        }
        return true;
      case 'wait':
        p.bubble = task.bubble;
        task.t -= dt;
        if (task.t <= 0 || (task.pair && task.pair.cancelled)) {
          p.bubble = null;
          return true;
        }
        return false;
      case 'until':
        task.timeout -= dt;
        return task.fn() || task.timeout <= 0;
      case 'call':
        task.fn();
        return true;
    }
    return true;
  }

  function walk(/** @type {any} */ p, /** @type {number} */ dt) {
    const target = p.path[0];
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy);
    const move = 72 * dt;
    p.pose = 'walk';
    if (Math.abs(dx) > Math.abs(dy)) {
      p.dir = dx < 0 ? 'left' : 'right';
    } else if (Math.abs(dy) > 0.01) {
      p.dir = dy < 0 ? 'up' : 'down';
    }
    if (dist <= move) {
      p.x = target.x;
      p.y = target.y;
      p.path.shift();
    } else {
      p.x += (dx / dist) * move;
      p.y += (dy / dist) * move;
    }
  }

  /** Comportement de base quand la file de tâches est vide : dicté par l'état réel. */
  function base(/** @type {any} */ p) {
    if (p.state === 'active') {
      const seat = station(p).seat;
      if (!atTile(p, seat)) {
        p.tasks.push(go(seat, 'type', station(p).dir));
      } else {
        p.pose = 'type';
        p.dir = station(p).dir;
        p.bubble = null;
      }
    } else if (p.state === 'unknown') {
      p.path = [];
      if (p.pose === 'walk' || p.pose === 'type') {
        p.pose = p.pose === 'type' ? 'sit' : 'stand';
      }
      p.bubble = '?';
    } else {
      p.bubble = null;
      pickLife(p);
    }
  }

  // ======================================================================
  // Cycle de vie décoratif (agents inactifs)
  // ======================================================================
  function availablePartner(/** @type {any} */ p) {
    const pool = [...people.values()].filter(
      (o) =>
        o !== p &&
        o.state === 'inactive' &&
        !o.pair &&
        !(o.cur && o.cur.scripted) &&
        !o.tasks.some((/** @type {any} */ t) => t.scripted),
    );
    return pool.length ? pick(pool) : null;
  }

  function freeSpot(/** @type {string} */ kind) {
    const pool = SPOTS.filter((s) => s.kind === kind && !spotTaken.has(s.key));
    return pool.length ? pick(pool) : null;
  }

  const LIFE = [['wander', 3.5], ['relax', 1.5], ['pond', 2.5], ['chat', 2.5]];

  function pickLife(/** @type {any} */ p) {
    let r = Math.random() * LIFE.reduce((s, o) => s + Number(o[1]), 0);
    let choice = 'wander';
    for (const [name, weight] of LIFE) {
      r -= Number(weight);
      if (r <= 0) {
        choice = String(name);
        break;
      }
    }
    if (choice === 'chat') {
      const partner = availablePartner(p);
      if (partner) {
        chat(p, partner);
        return;
      }
      choice = 'wander';
    }
    if (choice !== 'wander') {
      const spot = freeSpot(choice);
      if (spot) {
        spotTaken.set(spot.key, p.id);
        p.tasks.push(go(spot.tile, spot.pose, /** @type {Dir} */ (spot.dir)), wait(rand(6, 14), spot.bubble), call(() => releaseSpot(p)));
        return;
      }
    }
    p.tasks.push(go(pick(WANDER), 'stand'), wait(rand(1, 4), null));
  }

  /** Discussion à deux : rendez-vous sur deux cases face à face, puis échange de bulles. */
  function chat(/** @type {any} */ a, /** @type {any} */ b) {
    clearLife(b);
    const pair = { cancelled: false, arrived: new Set() };
    a.pair = pair;
    b.pair = pair;
    // Point de rencontre : une case libre et une autre deux colonnes plus loin.
    const ta = pick(WANDER.filter((t) => t.y >= ROOMS.open.y0 && free(t.x + 2, t.y) && !seatKeys.has(`${t.x + 2},${t.y}`)));
    const tb = { x: ta.x + 2, y: ta.y };
    const dur = rand(6, 11);
    const seq = (/** @type {Tile} */ tile, /** @type {Dir} */ dir, /** @type {string} */ bubble, /** @type {any} */ who) => [
      go(tile, 'stand', dir),
      call(() => pair.arrived.add(who.id)),
      until(() => pair.arrived.size >= 2 || pair.cancelled, 25),
      wait(dur, bubble, { pair }),
      call(() => {
        who.pair = null;
      }),
    ];
    a.tasks.push(...seq(ta, 'right', 'talkA', a));
    b.tasks.push(...seq(tb, 'left', 'talkB', b));
  }

  // ======================================================================
  // Scènes issues des délégations réelles
  // ======================================================================
  function runBrief(/** @type {string} */ fromName, /** @type {string[]} */ targetNames) {
    const P = byName(fromName);
    const Ts = targetNames.map(byName).filter((t) => t && t !== P);
    if (!P || !Ts.length) {
      return;
    }
    for (const x of [P, ...Ts]) {
      clearLife(x);
    }
    const m = { arrived: new Set(), size: Ts.length + 1 };
    const arrive = (/** @type {any} */ who) => call(() => m.arrived.add(who.id));
    const allHere = () => m.arrived.size >= m.size;

    if (Ts.length === 1) {
      // Visite : le délégant vient voir l'agent à son poste.
      const T0 = Ts[0];
      const st = station(T0);
      P.tasks.push(...scripted([doing(P, 'meeting'), go(st.visitor, 'stand', 'left'), arrive(P), until(allHere, 25), wait(4, 'talk'), doing(P, null)]));
      T0.tasks.push(...scripted([go(st.seat, 'type', st.dir), arrive(T0), until(allHere, 25), wait(4, 'listen')]));
      return;
    }
    // Réunion : petite salle jusqu'à 4 participants, grande au-delà.
    let room = m.size <= 4 ? MEETING.small : MEETING.big;
    if (room.busy) {
      room = room === MEETING.small ? MEETING.big : MEETING.small;
    }
    if (Ts.length > room.seats.length) {
      room = MEETING.big;
    }
    room.busy = m;
    const meetingRoom = room;
    const dur = 6 + Ts.length;
    P.tasks.push(
      ...scripted([
        doing(P, 'meeting'),
        go(meetingRoom.head, 'sit', seatDir(meetingRoom.head, meetingRoom.table)),
        arrive(P),
        until(allHere, 35),
        wait(dur, 'talk'),
        doing(P, null),
        call(() => {
          if (meetingRoom.busy === m) {
            meetingRoom.busy = null;
          }
        }),
      ]),
    );
    Ts.forEach((t, i) => {
      const seat = meetingRoom.seats[i % meetingRoom.seats.length];
      t.tasks.push(
        ...scripted([doing(t, 'meeting'), go(seat, 'sit', seatDir(seat, meetingRoom.table)), arrive(t), until(allHere, 35), wait(dur, null), doing(t, null)]),
      );
    });
  }

  /** Nombre de remises de copie en cours par délégant (pour ne pas s'empiler au même endroit). */
  const debriefQueue = new Map();
  function runDebrief(/** @type {string} */ fromName, /** @type {string} */ toName) {
    const P = byName(fromName);
    const A = byName(toName);
    if (!P || !A || P === A) {
      return;
    }
    clearLife(A);
    const st = station(P);
    const n = debriefQueue.get(P.id) || 0;
    debriefQueue.set(P.id, n + 1);
    const v = st.visitor;
    const candidates = [v, { x: v.x, y: v.y + 1 }, { x: v.x + 1, y: v.y }, { x: v.x, y: v.y - 1 }];
    const spot = candidates.filter((c) => free(c.x, c.y))[n % 4] || v;
    A.tasks.push(
      ...scripted([
        doing(A, 'paper'),
        go(spot, 'stand', 'left'),
        call(() => {
          P.flash = { bubble: 'check', t: 3.5 };
        }),
        wait(3.5, 'paper'),
        doing(A, null),
        call(() => debriefQueue.set(P.id, Math.max(0, (debriefQueue.get(P.id) || 1) - 1))),
      ]),
    );
  }

  /** Détecte les délégations nouvelles (lancement) et terminées (remise de copie). */
  function handleInteractions() {
    const now = snapshot.generatedAt;
    const FRESH = 90_000;
    for (const i of snapshot.interactions || []) {
      if (!seenStart.has(i.id)) {
        seenStart.add(i.id);
        if (!reduced() && !i.finishedAt && now - i.startedAt < FRESH) {
          const pend = pendingBriefs.get(i.from) || { targets: new Set(), at: clock };
          pend.targets.add(i.to);
          pendingBriefs.set(i.from, pend);
        }
      }
      if (i.finishedAt && !seenFinish.has(i.id)) {
        seenFinish.add(i.id);
        if (!reduced() && now - i.finishedAt < FRESH) {
          runDebrief(i.from, i.to);
        }
      }
    }
  }

  // ======================================================================
  // Synchronisation avec l'instantané
  // ======================================================================
  function sync() {
    if (!snapshot) {
      return;
    }
    const seen = new Set();
    const colors = assignColors(snapshot.slots);
    snapshot.slots.forEach((/** @type {any} */ slot) => {
      const a = slot.agent;
      if (!a || !slot.workstation || !STATIONS[slot.workstation]) {
        return;
      }
      seen.add(a.id);
      let p = people.get(a.id);
      if (!p) {
        const seed = hash(a.name);
        p = {
          id: a.id, name: a.name, seed, ws: slot.workstation, x: 0, y: 0, path: [], tasks: [], cur: null,
          pose: 'stand', dir: 'down', bubble: null, activity: null, flash: null, pair: null, state: a.state,
          color: colors.get(a.id),
          skin: SKINS[seed % SKINS.length], hair: HAIRS[(seed >>> 3) % HAIRS.length],
        };
        const start = a.state === 'active' ? STATIONS[slot.workstation].seat : WANDER[seed % WANDER.length];
        Object.assign(p, feet(start));
        people.set(a.id, p);
      }
      p.ws = slot.workstation;
      p.color = colors.get(a.id);
      if (p.state !== a.state) {
        p.state = a.state;
        clearLife(p); // le cycle de vie s'efface devant tout changement d'état réel
      }
    });
    for (const [id, p] of people) {
      if (!seen.has(id)) {
        clearLife(p);
        people.delete(id);
      }
    }
    handleInteractions();
  }

  /** Animations réduites : positions fixes, sans déplacement ni scène. */
  const STATIC_SPOTS = [
    ...SPOTS.map((s) => ({ tile: s.tile, pose: s.pose, dir: s.dir })),
    ...[[37, 20], [33, 20], [39, 23], [41, 19], [34, 24]].map(([x, y]) => ({ tile: { x, y }, pose: 'stand', dir: 'down' })),
  ];
  function placeStatic() {
    const idle = [...people.values()].filter((p) => p.state !== 'active').sort((a, b) => a.seed - b.seed);
    for (const p of people.values()) {
      p.tasks = [];
      p.cur = null;
      p.path = [];
      p.pair = null;
      p.flash = null;
      p.activity = null;
      if (p.state === 'active') {
        Object.assign(p, feet(station(p).seat));
        p.pose = 'type';
        p.dir = station(p).dir;
        p.bubble = null;
      } else {
        if (p.state === 'inactive' || !p.placed) {
          const s = STATIC_SPOTS[idle.indexOf(p) % STATIC_SPOTS.length];
          Object.assign(p, feet(s.tile));
          p.pose = s.pose;
          p.dir = s.dir;
        } else if (p.pose === 'type') {
          p.pose = 'sit';
        }
        p.bubble = p.state === 'unknown' ? '?' : null;
      }
      p.placed = true;
    }
  }

  // ======================================================================
  // Simulation
  // ======================================================================
  function step(/** @type {number} */ dt) {
    clock += dt;
    for (const [from, pend] of [...pendingBriefs]) {
      // Les délégations lancées ensemble (à quelques secondes près) forment une seule réunion.
      if (clock - pend.at >= 4) {
        pendingBriefs.delete(from);
        runBrief(from, [...pend.targets]);
      }
    }
    for (const p of people.values()) {
      p.placed = false;
      if (p.flash) {
        p.flash.t -= dt;
        if (p.flash.t <= 0) {
          p.flash = null;
        }
      }
      for (let guard = 0; guard < 4; guard++) {
        if (!p.cur) {
          p.cur = p.tasks.shift() || null;
          if (!p.cur) {
            base(p);
            p.cur = p.tasks.shift() || null;
            if (!p.cur) {
              break;
            }
          }
          startTask(p, p.cur);
        }
        if (runTask(p, p.cur, dt)) {
          p.cur = null;
          continue;
        }
        break;
      }
    }
  }

  // ======================================================================
  // Dessin — palette chaude, contours sombres, vue de dessus en 3/4
  // ======================================================================
  const O = '#2b2236'; // contour
  const C = {
    wallTop: '#dbe4f1', wallBand: '#a9badb', wallBase: '#7d8bb0', wallCap: '#f6f8fc', wallSide: '#c7d0e0',
    brick: '#eaa86a', brick2: '#e39c5b', mortar: '#c9824c',
    parquet: '#e9b27a', parquet2: '#dfa268', plank: '#c98a52',
    tile: '#f1f4f7', tile2: '#e7ebf0', grout: '#cfd6de',
    corridor: '#e3e8ee', corridor2: '#d8dee6',
    grass: '#a6dcaf', grass2: '#98d3a2', tuft: '#7fc28c',
    desk: '#f6e0b3', deskEdge: '#dcbc85', exec: '#c98a4b', execEdge: '#a56b36',
    metal: '#5a6376', screenOff: '#4a5870', screenGlare: '#66779a', screenOn: '#2f4d5c',
    chair: '#5d6c90', chairHi: '#7b8bb0',
    wood: '#c98a4b', woodDark: '#9c6532', woodLight: '#e0a868',
    plant: '#5cb85c', plantDark: '#3d8b3d', pot: '#c9663e', potDark: '#9a4a28',
    white: '#ffffff', paper: '#fbfaf5', red: '#e2504f', blue: '#4a78c2', yellow: '#f2c03a', green: '#5cae5c', purple: '#8e5fc2',
  };

  const px = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ c, /** @type {CanvasRenderingContext2D=} */ g) => {
    const c2 = g || ctx;
    c2.fillStyle = c;
    c2.fillRect(Math.round(x), Math.round(y), w, h);
  };
  /** Rectangle plein avec contour sombre, reflet en haut et ombre en bas. */
  function box(
    /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h,
    /** @type {string} */ fill, /** @type {string=} */ hi, /** @type {string=} */ lo, /** @type {CanvasRenderingContext2D=} */ g,
  ) {
    px(x, y, w, h, O, g);
    px(x + 1, y + 1, w - 2, h - 2, fill, g);
    if (hi) {
      px(x + 1, y + 1, w - 2, 1, hi, g);
    }
    if (lo) {
      px(x + 1, y + h - 2, w - 2, 1, lo, g);
    }
  }

  /** Sprites dessinés à la main (une lettre = une couleur), mis en cache. */
  const spriteCache = new Map();
  function sprite(/** @type {string[]} */ rows, /** @type {Record<string,string>} */ pal, /** @type {string} */ key, /** @type {boolean=} */ flip) {
    const k = `${key}|${flip ? 1 : 0}`;
    let c = spriteCache.get(k);
    if (!c) {
      c = document.createElement('canvas');
      c.width = rows[0].length;
      c.height = rows.length;
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const col = row[flip ? row.length - 1 - x : x];
          if (col !== '.' && pal[col]) {
            g.fillStyle = pal[col];
            g.fillRect(x, y, 1, 1);
          }
        }
      });
      spriteCache.set(k, c);
    }
    return c;
  }

  const PLANT = [
    '...oo..oo...', '..oLLooLLo..', '.oLLLLLLLLo.', '.oLDLLLLDLo.', 'oLLLDLLDLLLo', 'oLDLLLLLLDLo',
    '.oLLLDDLLLo.', '..ooLLLLoo..', '...oDLLDo...', '..oooooooo..', '..oPPPPPPo..', '..oPQPPPPo..',
    '...oPPPPo...', '...oPPPPo...', '...oQQQQo...', '....oooo....',
  ];
  const PLANT_PAL = { o: O, L: C.plant, D: C.plantDark, P: C.pot, Q: C.potDark };
  const COOLER = [
    '..oooooo..', '.oBBBBBBo.', '.oBWBBBBo.', '.oBWBBBBo.', '.oBBBBBBo.', '..oBBBBo..', '..oooooo..',
    '.oGGGGGGo.', '.oGrGGbGo.', '.oGGGGGGo.', '.oGGGGGGo.', '.oHHHHHHo.', '.oGGGGGGo.', '.oGGGGGGo.',
    '.oGGGGGGo.', '.oHHHHHHo.', '.oooooooo.',
  ];
  const COOLER_PAL = { o: O, B: '#9fd8f5', W: '#e6f6ff', G: '#e9eef5', H: '#b9c3d3', r: C.red, b: C.blue };
  const CLOCK = ['..ooooo..', '.oWWWWWo.', 'oWWWoWWWo', 'oWWWoWWWo', 'oWWWooWWo', 'oWWWWWWWo', 'oWWWWWWWo', '.oWWWWWo.', '..ooooo..'];

  // ---------- Personnages (style RPG : grosse tête, contour sombre) ----------
  const HEAD = {
    down: ['...oooooo...', '..ohhhhhho..', '.ohhhhhhhho.', 'ohhhhhhhhhho', 'ohhhhhhhhhho', 'ohssssssssho', 'ohssessessho', 'ohssessessho', '.osssssssso.', '..oossssoo..'],
    up: ['...oooooo...', '..ohhhhhho..', '.ohhhhhhhho.', 'ohhhhhhhhhho', 'ohhhhhhhhhho', 'ohhhhhhhhhho', 'ohhhhhhhhhho', 'ohhhhhhhhhho', '.ohhhhhhhho.', '..oossssoo..'],
    side: ['...ooooo....', '..ohhhhhoo..', '.ohhhhhhhho.', 'ohhhhhhhhhho', 'ohhhhhhhhhho', 'ohhhhsssssho', 'ohhhsssseso.', 'ohhhsssseso.', '.ohhsssssso.', '..oossssoo..'],
  };
  const BODY = {
    front: ['.occcccccco.', 'occcccccccco', 'osccccccccso', '.oddddddddo.', '.oppppppppo.'],
    side: ['..occcccco..', '..occcccco..', '..occcscco..', '..oddddddo..', '..oppppppo..'],
  };
  const LEGS = {
    front: [
      ['.opppoopppo.', '.oppo..oppo.', '.okko..okko.'],
      ['.opppoopppo.', '.okko..oppo.', '.......okko.'],
      ['.opppoopppo.', '.oppo..okko.', '.okko.......'],
    ],
    side: [
      ['...opppo....', '...oppo.....', '...okkko....'],
      ['..oppoppo...', '.oppo.oppo..', '.okko.okkko.'],
      ['...opppo....', '...oppo.....', '...okkko....'],
    ],
  };
  const SIT_LEGS = {
    down: ['.oppppppppo.', '.okko..okko.'],
    up: ['.oppppppppo.', '.oppo..oppo.'],
    side: ['..opppppppo.', '........okko'],
  };

  function personRows(/** @type {any} */ p, /** @type {number} */ t) {
    const anim = !reduced();
    const dir = p.dir || 'down';
    const view = dir === 'left' || dir === 'right' ? 'side' : dir;
    const head = HEAD[view];
    const body = BODY[view === 'side' ? 'side' : 'front'];
    if (p.pose === 'sit' || p.pose === 'type') {
      const rows = [...head, body[0], body[1], body[2], body[4], ...SIT_LEGS[view]];
      if (p.pose === 'type' && anim && Math.floor(t * 8 + p.seed) % 2) {
        rows[12] = 'ocsccccccsco'; // mains qui tapent
      }
      return rows;
    }
    let frame = 0;
    if (p.pose === 'walk' && anim) {
      frame = 1 + (Math.floor(t * 8 + p.seed) % 2);
    }
    return [...head, ...body, ...LEGS[view === 'side' ? 'side' : 'front'][frame]];
  }

  function shade(/** @type {string} */ hex, /** @type {number} */ k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (/** @type {number} */ v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }

  function drawPerson(/** @type {any} */ p, /** @type {number} */ t) {
    const grey = p.state === 'unknown';
    const shirt = grey ? '#a3a9b8' : p.color;
    const pal = {
      o: O,
      h: grey ? '#868c9c' : p.hair,
      s: grey ? '#cfd2da' : p.skin,
      e: O,
      c: shirt,
      d: shade(shirt, 0.78),
      p: grey ? '#6d7386' : '#3c4a7a',
      k: grey ? '#5a5f6e' : '#5a3d33',
    };
    const rows = personRows(p, t);
    const key = `${p.id}|${p.color}|${grey}|${rows.join('')}`;
    const img = sprite(rows, pal, key, p.dir === 'left');
    const bob = !reduced() && p.pose === 'stand' && Math.floor(t * 1.4 + (p.seed % 5)) % 2 ? 1 : 0;
    const x = Math.round(p.x) - 6;
    const tile = tileOf(p);
    // Assis à son poste, l'agent est rapproché du bureau pour rester visible au-dessus du dossier.
    const lift = p.pose === 'type' && p.dir === 'up' ? 3 : 0;
    // Derrière un bureau individuel, l'agent s'enfonce sous le plateau : jambes et fauteuil restent cachés.
    const sink = (p.pose === 'type' || p.pose === 'sit') && p.dir === 'down' && officeSeatKeys.has(`${tile.x},${tile.y}`) ? 3 : 0;
    const y = Math.round(p.y) - rows.length + 1 + bob - lift + sink;
    if (!sink) {
      // Ombre portée
      ctx.fillStyle = 'rgba(43, 34, 54, 0.22)';
      ctx.fillRect(x + 1, Math.round(p.y) - 1, 10, 3);
    }
    ctx.drawImage(img, x, y);
    // Priorité : bulle éclair, bulle ponctuelle de la scène, activité en cours, puis « au travail » dès que l'agent est actif.
    const bubble = (p.flash && p.flash.bubble) || p.bubble || p.activity || (p.state === 'active' ? 'work' : null);
    // Les bulles sont dessinées après tout le reste : elles restent au premier plan.
    return bubble ? () => drawBubble(x + 7, y - 12, bubble, t) : null;
  }

  function drawBubble(/** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ kind, /** @type {number} */ t) {
    if (kind === 'talkA' || kind === 'talkB') {
      // Discussion : les deux interlocuteurs parlent à tour de rôle.
      if (!reduced() && Math.floor(t * 0.8) % 2 !== (kind === 'talkA' ? 0 : 1)) {
        return;
      }
      kind = 'talk';
    }
    const bg = kind === 'check' ? '#d9f6cf' : kind === 'work' ? '#dcf7e6' : kind === 'meeting' ? '#e6ddf7' : C.white;
    box(x, y, 13, 10, bg);
    px(x + 2, y + 9, 4, 1, bg);
    px(x + 2, y + 9, 1, 2, O);
    px(x + 3, y + 10, 2, 1, O);
    px(x + 5, y + 9, 1, 1, O);
    const ink = O;
    switch (kind) {
      case 'talk':
        for (let i = 0; i < 3; i++) {
          px(x + 3 + i * 3, y + 5, 1, 1, ink);
        }
        break;
      case 'listen':
        px(x + 4, y + 3, 5, 1, '#8a93a6');
        px(x + 4, y + 5, 5, 1, '#8a93a6');
        break;
      case 'paper':
        box(x + 4, y + 2, 6, 7, C.paper);
        px(x + 5, y + 4, 3, 1, '#8a93a6');
        px(x + 5, y + 6, 3, 1, '#8a93a6');
        break;
      case 'work': {
        // Petit ordinateur dont les lignes de code s'écrivent
        box(x + 3, y + 2, 7, 5, '#2f4d5c');
        const n = reduced() ? 3 : 1 + (Math.floor(t * 4) % 3);
        const lines = ['#8ff0c8', '#ffd36b', '#8fc2ff'];
        for (let i = 0; i < n; i++) {
          px(x + 4, y + 3 + i, 2 + ((i * 2) % 4), 1, lines[i]);
        }
        px(x + 2, y + 7, 9, 1, O);
        break;
      }
      case 'meeting':
        // Deux participants face à face autour d'une table
        px(x + 3, y + 2, 2, 2, '#e9ad82');
        px(x + 8, y + 2, 2, 2, '#e9ad82');
        px(x + 2, y + 4, 4, 2, '#3f7fe0');
        px(x + 7, y + 4, 4, 2, '#f08a3c');
        px(x + 2, y + 7, 9, 1, '#9c6532');
        break;
      case 'check':
        px(x + 3, y + 5, 1, 1, '#2f8f3a');
        px(x + 4, y + 6, 1, 1, '#2f8f3a');
        px(x + 5, y + 5, 1, 1, '#2f8f3a');
        px(x + 6, y + 4, 1, 1, '#2f8f3a');
        px(x + 7, y + 3, 1, 1, '#2f8f3a');
        px(x + 8, y + 2, 1, 1, '#2f8f3a');
        break;
      case 'coffee':
        box(x + 3, y + 3, 6, 6, C.white);
        px(x + 4, y + 4, 4, 2, '#8a5a3a');
        px(x + 9, y + 5, 1, 2, O);
        break;
      case 'drink':
        // Verre de jus avec paille
        box(x + 4, y + 3, 5, 6, '#ffe7b0');
        px(x + 5, y + 5, 3, 3, '#f59a3c');
        px(x + 7, y + 1, 1, 3, C.red);
        px(x + 8, y + 1, 2, 1, C.red);
        break;
      case 'zzz':
        px(x + 3, y + 3, 3, 1, '#5b7bd6');
        px(x + 4, y + 4, 1, 1, '#5b7bd6');
        px(x + 3, y + 5, 3, 1, '#5b7bd6');
        px(x + 7, y + 5, 3, 1, '#8aa3ec');
        px(x + 8, y + 6, 1, 1, '#8aa3ec');
        px(x + 7, y + 7, 3, 1, '#8aa3ec');
        break;
      case '?':
        px(x + 5, y + 2, 3, 1, ink);
        px(x + 8, y + 3, 1, 2, ink);
        px(x + 6, y + 5, 2, 1, ink);
        px(x + 6, y + 7, 1, 1, ink);
        break;
    }
  }

  // ---------- Fond statique (sols, murs, décor mural) : dessiné une seule fois ----------
  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (bg.getContext('2d'));

  function floorBricks(/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ w, /** @type {number} */ h) {
    for (let y = y0, row = 0; y < y0 + h; y += 6, row++) {
      const off = row % 2 ? 6 : 0;
      for (let x = x0 - off; x < x0 + w; x += 12) {
        const bx = Math.max(x, x0);
        const bw = Math.min(x + 12, x0 + w) - bx;
        const bh = Math.min(6, y0 + h - y);
        px(bx, y, bw, bh, hash(`${x},${y}`) % 4 ? C.brick : C.brick2, g);
        px(bx, y + bh - 1, bw, 1, C.mortar, g);
        if (x >= x0) {
          px(x, y, 1, bh, C.mortar, g);
        }
        if (hash(`d${x},${y}`) % 7 === 0) {
          px(bx + 3, y + 2, 2, 1, C.mortar, g);
        }
      }
    }
  }
  function floorParquet(/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ w, /** @type {number} */ h) {
    for (let y = y0, row = 0; y < y0 + h; y += 4, row++) {
      const off = (row * 7) % 20;
      px(x0, y, w, 4, row % 2 ? C.parquet : C.parquet2, g);
      px(x0, y + 3, w, 1, C.plank, g);
      for (let x = x0 - off; x < x0 + w; x += 20) {
        if (x > x0) {
          px(x, y, 1, 3, C.plank, g);
        }
      }
    }
  }
  function floorTiles(/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ a, /** @type {string} */ b) {
    for (let y = y0; y < y0 + h; y += 8) {
      for (let x = x0; x < x0 + w; x += 8) {
        px(x, y, 8, 8, ((x + y) / 8) % 2 ? a : b, g);
        px(x, y + 7, 8, 1, C.grout, g);
        px(x + 7, y, 1, 8, C.grout, g);
      }
    }
  }
  function floorGrass(/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ w, /** @type {number} */ h) {
    px(x0, y0, w, h, C.grass, g);
    for (let y = y0; y < y0 + h; y += 4) {
      for (let x = x0; x < x0 + w; x += 4) {
        const r = hash(`g${x},${y}`) % 13;
        if (r === 0) {
          px(x + 1, y + 1, 1, 2, C.tuft, g);
          px(x + 2, y, 1, 3, C.tuft, g);
        } else if (r < 3) {
          px(x, y + 2, 2, 1, C.grass2, g);
        }
      }
    }
  }

  /** Coin détente : taches d'herbe, fleurs sauvages, chemin de pierres et étang. */
  function drawNatureGround() {
    const x0 = ROOMS.lounge.x0 * T;
    const y0 = ROOMS.lounge.y0 * T;
    // Taches d'herbe plus sombre
    for (const [cx, cy, r] of [[34, 16, 2], [34, 22, 2], [42, 24, 1]]) {
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (x * x + y * y <= r * r && cx + x >= ROOMS.lounge.x0 && hash(`p${cx + x},${cy + y}`) % 3) {
            px((cx + x) * T, (cy + y) * T, T, T, C.grass2, g);
          }
        }
      }
    }
    // Fleurs sauvages
    const petals = ['#ffffff', '#ffd23f', '#ec6fae', '#e2504f', '#b48cf0'];
    for (let y = y0 + 4; y < H - 4; y += 5) {
      for (let x = x0 + 4; x < W - 4; x += 5) {
        const h = hash(`f${x},${y}`);
        if (h % 31 === 0) {
          const c = petals[(h >>> 5) % petals.length];
          px(x - 1, y, 3, 1, c, g);
          px(x, y - 1, 1, 3, c, g);
          px(x, y, 1, 1, '#f2a03a', g);
        }
      }
    }
    // Chemin de petits pavés depuis le couloir, vers l'étang, le hamac et les transats
    const stones = [
      [38, 13], [38, 14.8], [38.2, 16.6], [38, 18.4], [38.6, 20], [40.4, 19.8], [42.2, 20.4],
    ];
    for (const [sx, sy] of stones) {
      const X = Math.round(sx * T) + 1;
      const Y = Math.round(sy * T) + 2;
      px(X + 1, Y, 6, 5, O, g);
      px(X, Y + 1, 8, 3, O, g);
      px(X + 1, Y + 1, 6, 3, '#d8d2c2', g);
      px(X + 2, Y + 1, 3, 1, '#efeadf', g);
    }
    // Étang : berge de galets, eau, nénuphars
    const pd = LOUNGE.pond;
    const X = pd.x * T;
    const Y = pd.y * T;
    const Wd = pd.w * T;
    const Hd = pd.h * T;
    px(X + 3, Y - 1, Wd - 6, Hd + 2, O, g);
    px(X - 1, Y + 3, Wd + 2, Hd - 6, O, g);
    px(X + 1, Y + 1, Wd - 2, Hd - 2, O, g);
    px(X + 3, Y, Wd - 6, Hd, '#c9c2b0', g);
    px(X, Y + 3, Wd, Hd - 6, '#c9c2b0', g);
    px(X + 1, Y + 1, Wd - 2, Hd - 2, '#c9c2b0', g);
    px(X + 4, Y + 2, Wd - 8, Hd - 4, '#4f9fdc', g);
    px(X + 2, Y + 4, Wd - 4, Hd - 8, '#4f9fdc', g);
    px(X + 5, Y + 3, Wd - 10, 3, '#7cc0ee', g);
    for (const [lx, ly] of [[7, 18], [24, 21], [28, 8]]) {
      px(X + lx, Y + ly, 6, 4, '#3d8b3d', g);
      px(X + lx + 1, Y + ly, 4, 3, '#5cb85c', g);
      px(X + lx + 3, Y + ly, 1, 2, '#3d8b3d', g);
    }
    px(X + 25, Y + 20, 2, 2, '#ec6fae', g);
    for (let i = 0; i < Wd; i += 7) {
      px(X + 2 + i, Y + (i % 2 ? 1 : Hd - 3), 3, 2, '#9b9384', g);
    }
  }

  /** Mur côté couloir (vu de dessus), percé de portes de deux cases. */
  function corridorWall(/** @type {number} */ row, /** @type {number} */ x0, /** @type {number} */ x1, /** @type {number[]} */ doorXs) {
    for (let x = x0; x <= x1; x++) {
      const X = x * T;
      const Y = row * T;
      if (!free(x, row)) {
        px(X, Y, T, 3, C.wallCap, g);
        px(X, Y + 3, T, 5, C.wallBand, g);
        px(X, Y + 7, T, 1, O, g);
        px(X, Y - 1, T, 1, O, g);
        px(X, Y + 3, T, 1, O, g);
      } else {
        px(X, Y, T, T, C.woodLight, g);
        px(X, Y + 7, T, 1, C.woodDark, g);
      }
    }
    for (const d of doorXs) {
      const X = d * T;
      px(X - 1, row * T - 1, 2, T + 1, O, g);
      px(X + 2 * T - 1, row * T - 1, 2, T + 1, O, g);
    }
  }

  function drawStatic() {
    px(0, 0, W, H, '#c7cfdc', g);
    // Sols
    for (const room of Object.values(ROOMS)) {
      const x = room.x0 * T;
      const y = room.y0 * T;
      const w = (room.x1 - room.x0 + 1) * T;
      const h = (room.y1 - room.y0 + 1) * T;
      if (room.floor === 'bricks') floorBricks(x, y, w, h);
      else if (room.floor === 'parquet') floorParquet(x, y, w, h);
      else if (room.floor === 'tiles') floorTiles(x, y, w, h, C.tile, C.tile2);
      else floorGrass(x, y, w, h);
    }
    floorTiles(0, CORRIDOR.y0 * T, W, (CORRIDOR.y1 - CORRIDOR.y0 + 1) * T, C.corridor, C.corridor2);
    const yb = ROOMS.open.y0 * T;
    px(ROOMS.open.x0 * T, yb, (ROOMS.open.x1 - ROOMS.open.x0 + 1) * T, 1, C.mortar, g);
    px(ROOMS.lounge.x0 * T, yb, (ROOMS.lounge.x1 - ROOMS.lounge.x0 + 1) * T, 1, C.tuft, g);
    px(ROOMS.lounge.x0 * T, yb, 1, H - yb, C.tuft, g);

    drawNatureGround();

    // Façade : mur bleu clair, bandeau, plinthe
    px(0, 0, W, 14, C.wallTop, g);
    px(0, 14, W, 7, C.wallBand, g);
    px(0, 14, W, 1, C.wallBase, g);
    px(0, 21, W, 3, C.wallBase, g);
    px(0, 23, W, 1, O, g);
    for (let x = 0; x < W; x += 4) {
      px(x, 16 + ((x / 4) % 2) * 2, 2, 1, '#9aaed2', g);
    }

    // Décor mural par pièce
    const windowAt = (/** @type {number} */ x) => {
      box(x, 2, 26, 15, C.wallCap, undefined, undefined, g);
      px(x + 2, 4, 22, 11, '#9fd3f0', g);
      px(x + 2, 4, 22, 3, '#c6e7f8', g);
      px(x + 12, 3, 2, 13, C.wallCap, g);
      px(x + 3, 9, 4, 1, C.white, g);
      px(x + 15, 6, 3, 1, C.white, g);
    };
    windowAt(18);
    windowAt(120);
    windowAt(216);
    // Tableau (arbre) dans le bureau PM
    box(50, 4, 16, 14, '#8a5a3a', undefined, undefined, g);
    px(52, 6, 12, 10, '#9fd3f0', g);
    px(52, 13, 12, 3, '#7cc47c', g);
    px(56, 7, 5, 5, '#4f9f4f', g);
    px(58, 11, 1, 3, '#8a5a3a', g);
    // Horloge PM
    g.drawImage(sprite(CLOCK, { o: O, W: C.white }, 'clock'), 4, 5);
    // Affiche « idée » chez le challenger
    box(150, 4, 14, 15, C.paper, undefined, undefined, g);
    px(155, 6, 4, 4, C.yellow, g);
    px(156, 10, 2, 2, '#8a93a6', g);
    px(153, 13, 8, 1, '#8a93a6', g);
    px(153, 15, 6, 1, '#8a93a6', g);
    // Palette de couleurs chez le designer
    box(246, 4, 18, 14, C.paper, undefined, undefined, g);
    [[248, 6, C.red], [253, 6, C.yellow], [258, 6, C.blue], [248, 11, C.green], [253, 11, C.purple], [258, 11, '#ec6fae']].forEach(([x, y, c]) =>
      px(/** @type {number} */ (x), /** @type {number} */ (y), 4, 4, /** @type {string} */ (c), g),
    );
    // Tableau blanc des salles de réunion
    const whiteboard = (/** @type {number} */ x, /** @type {number} */ w) => {
      box(x, 3, w, 15, C.white, undefined, undefined, g);
      px(x + 3, 6, w / 3, 1, C.blue, g);
      px(x + 3, 9, w / 2, 1, C.red, g);
      px(x + 3, 12, w / 4, 1, C.green, g);
      px(x + w - 12, 6, 7, 7, '#f6e58d', g);
      px(x + 2, 17, w - 4, 2, '#8a93a6', g);
    };
    whiteboard(306, 40);
    g.drawImage(sprite(CLOCK, { o: O, W: C.white }, 'clock'), 354, 5);

    // Cloisons (murs blancs épais)
    for (const c of PARTITIONS) {
      const x = c * T;
      px(x + 1, 0, 6, TOP_WALL * T, O, g);
      px(x + 2, 0, 4, TOP_WALL * T, C.wallCap, g);
      px(x + 5, 0, 1, TOP_WALL * T, C.wallSide, g);
    }
    // Murs côté couloir avec portes ; celui de la grande salle s'arrête contre la cloison de l'open space.
    corridorWall(TOP_WALL, 0, COLS - 1, doors);
    corridorWall(BIG_WALL, 0, BIG_PARTITION - 1, [ROOMS.big.door]);
    // Grande salle : cloison avec l'open space, qui monte jusqu'au bord haut du mur côté couloir (angle net)
    {
      const x = BIG_PARTITION * T;
      const top = BIG_WALL * T - 1;
      px(x + 1, top, 6, H - top, O, g);
      px(x + 2, top + 1, 4, H - top - 1, C.wallCap, g);
      px(x + 5, top + 1, 1, H - top - 1, C.wallSide, g);
    }
    // Cadre général
    g.strokeStyle = O;
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
  drawStatic();

  /** Mobilier trié par profondeur avec les personnages. */
  /** @type {{base:number, draw:(t:number)=>void}[]} */
  const furniture = [];
  const occupant = (/** @type {string} */ ws) =>
    snapshot && snapshot.slots.find((/** @type {any} */ s) => s.workstation === ws)?.agent;

  /** Écran vu de face : éteint, ou allumé avec des lignes décoratives quand l'agent travaille. */
  function monitor(/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ on, /** @type {number} */ t, /** @type {number} */ seed) {
    box(x, y, 16, 12, C.metal, '#7a8396');
    if (on) {
      px(x + 2, y + 2, 12, 7, C.screenOn);
      const colors = ['#8ff0c8', '#ffd36b', '#8fc2ff', '#f59ac0'];
      const scroll = reduced() ? 0 : Math.floor(t * 3);
      for (let i = 0; i < 3; i++) {
        const len = 3 + ((seed + i + scroll) * 7) % 8;
        px(x + 3, y + 3 + i * 2, Math.min(len, 10), 1, colors[(seed + i + scroll) % colors.length]);
      }
    } else {
      px(x + 2, y + 2, 12, 7, C.screenOff);
      px(x + 3, y + 3, 3, 1, C.screenGlare);
      px(x + 3, y + 4, 1, 2, C.screenGlare);
    }
    px(x + 6, y + 12, 4, 2, O);
    px(x + 4, y + 13, 8, 1, O);
  }

  /** Écran vu de dos (bureaux individuels) : une bande LED s'allume au-dessus quand l'agent travaille. */
  function monitorBack(/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ on, /** @type {number} */ t) {
    if (on) {
      const k = reduced() ? 0.35 : 0.28 + 0.1 * Math.sin(t * 5);
      ctx.fillStyle = `rgba(120, 240, 255, ${k})`;
      ctx.fillRect(x - 2, y - 6, 18, 6);
    }
    box(x, y, 14, 11, C.metal, '#7a8396');
    px(x + 3, y + 3, 8, 1, '#4a5263');
    px(x + 3, y + 5, 8, 1, '#4a5263');
    px(x + 5, y + 11, 4, 2, O);
    px(x + 3, y + 12, 8, 1, O);
    // Bande LED
    px(x + 1, y - 2, 12, 2, O);
    px(x + 2, y - 2, 10, 1, on ? '#8ff8ff' : '#6b7486');
  }

  /** Couleur de l'agent installé à un poste (pour l'objet personnel posé sur le bureau). */
  const ownerColor = (/** @type {string} */ ws) => {
    const a = occupant(ws);
    const p = a && people.get(a.id);
    return p ? p.color : '#b9c3d3';
  };

  for (const [id, s] of Object.entries(STATIONS)) {
    const dx = s.desk.x * T;
    const dy = s.desk.y * T;
    const office = s.kind === 'office';
    const sx = s.seat.x * T + 4;
    const sy = s.seat.y * T + 7;
    if (office) {
      // Fauteuil côté mur : seuls le dossier et l'assise dépassent, le plateau du bureau cache le reste.
      furniture.push({
        base: sy - 1,
        draw: () => {
          box(sx - 7, sy - 18, 14, 13, C.chair, C.chairHi);
          px(sx - 5, sy - 15, 10, 1, C.chairHi);
          box(sx - 6, sy - 6, 12, 7, C.chair, C.chairHi);
        },
      });
      furniture.push({
        base: (s.desk.y + s.desk.h) * T,
        draw: (t) => {
          const a = occupant(id);
          const active = !!(a && a.state === 'active');
          const mine = ownerColor(id);
          box(dx - 2, dy, 36, 12, C.exec, '#dca066');
          box(dx - 2, dy + 11, 36, 6, C.execEdge);
          px(dx + 1, dy + 13, 30, 1, '#8a5528');
          monitorBack(dx, dy - 7, active, t);
          box(dx + 15, dy, 12, 3, '#5a6376'); // clavier, côté agent (sous ses mains)
          px(dx + 16, dy + 1, 10, 1, '#8a93a6');
          box(dx + 2, dy + 5, 9, 5, C.paper); // dossier, devant l'écran
          px(dx + 3, dy + 7, 6, 1, '#8a93a6');
          // Lampe et tasse aux couleurs de l'agent
          px(dx + 31, dy - 4, 2, 9, O);
          box(dx + 28, dy - 8, 8, 5, mine);
          box(dx + 26, dy + 4, 5, 6, mine);
          px(dx + 31, dy + 6, 1, 2, O);
        },
      });
    } else {
      furniture.push({
        base: (s.desk.y + s.desk.h) * T,
        draw: (t) => {
          const a = occupant(id);
          const active = !!(a && a.state === 'active');
          const mine = ownerColor(id);
          box(dx, dy, 32, 12, C.desk, C.white);
          box(dx, dy + 11, 32, 5, C.deskEdge);
          px(dx + 1, dy + 16, 2, 2, O);
          px(dx + 29, dy + 16, 2, 2, O);
          monitor(dx + 8, dy - 8, active, t, s.n * 3);
          box(dx + 9, dy + 6, 14, 4, '#e8ecf2'); // clavier
          px(dx + 11, dy + 7, 10, 1, '#b9c3d3');
          box(dx + 24, dy + 6, 3, 4, '#e8ecf2'); // souris
          // Tasse et pochette aux couleurs de l'agent
          box(dx + 1, dy + 3, 5, 6, mine);
          px(dx + 6, dy + 5, 1, 2, O);
          box(dx + 2, dy - 3, 5, 4, mine);
          box(dx + 28, dy - 4, 5, 10, '#d4dae4'); // tour du PC
          px(dx + 30, dy - 2, 1, 1, active ? '#58d68d' : '#8a93a6');
        },
      });
      // Chaise vue de dos, dessinée après l'agent assis (elle masque ses jambes)
      furniture.push({
        base: sy + 0.5,
        draw: () => {
          box(sx - 5, sy - 2, 10, 4, C.chair, C.chairHi);
          px(sx - 1, sy + 2, 2, 2, O);
          px(sx - 4, sy + 3, 8, 1, O);
        },
      });
    }
  }

  // Bibliothèques et plantes des bureaux individuels
  const BOOKS = [C.red, C.blue, C.green, C.yellow, C.purple, '#f08a3c'];
  for (const room of [ROOMS.pm, ROOMS.challenger, ROOMS.design]) {
    const ox = room.x0 * T;
    furniture.push({
      base: 4 * T,
      draw: () => {
        const x = ox + 71;
        box(x, 4, 17, 28, C.wood, C.woodLight);
        for (let shelf = 0; shelf < 3; shelf++) {
          const y = 7 + shelf * 8;
          px(x + 2, y + 6, 14, 1, C.woodDark);
          for (let b = 0; b < 4; b++) {
            const c = BOOKS[(b + shelf * 2 + room.x0) % BOOKS.length];
            px(x + 2 + b * 3 + (b > 1 ? 1 : 0), y + (b % 2), 2, 6 - (b % 2), c);
          }
        }
      },
    });
    furniture.push({ base: 4 * T, draw: () => ctx.drawImage(sprite(PLANT, PLANT_PAL, 'plant'), ox - 2, 3 * T - 9) });
  }

  // Tables de réunion, chaises et accessoires
  for (const m of Object.values(MEETING)) {
    const tb = m.table;
    for (const seat of [m.head, ...m.seats]) {
      const dir = seatDir(seat, tb);
      const cx = seat.x * T + 4;
      const cy = seat.y * T + 7;
      if (dir === 'down') {
        // Dossier derrière la personne
        furniture.push({ base: cy - 1, draw: () => box(cx - 5, cy - 13, 10, 9, C.chair, C.chairHi) });
      } else if (dir === 'up') {
        furniture.push({ base: cy + 0.5, draw: () => box(cx - 5, cy - 4, 10, 5, C.chair, C.chairHi) });
      } else {
        const bx = dir === 'right' ? cx - 7 : cx + 3;
        furniture.push({ base: cy - 1, draw: () => box(bx, cy - 11, 4, 12, C.chair, C.chairHi) });
      }
    }
    furniture.push({
      base: (tb.y + tb.h) * T,
      draw: () => {
        const x = tb.x * T;
        const y = tb.y * T;
        const w = tb.w * T;
        const h = tb.h * T;
        box(x, y - 2, w, h - 2, C.wood, C.woodLight);
        box(x, y + h - 5, w, 5, C.woodDark);
        box(x + 5, y + 3, 7, 5, C.paper);
        box(x + w - 14, y + 6, 8, 6, '#5a6376');
        px(x + w - 13, y + 7, 6, 3, '#8fc2ff');
        box(x + w / 2 - 3, y + 4, 5, 5, C.white);
        px(x + w / 2 - 2, y + 5, 3, 2, '#8a5a3a');
      },
    });
  }

  // Reflets animés sur l'étang
  furniture.push({
    base: LOUNGE.pond.y * T,
    draw: (time) => {
      if (reduced()) {
        return;
      }
      const X = LOUNGE.pond.x * T;
      const Y = LOUNGE.pond.y * T;
      for (let i = 0; i < 3; i++) {
        const k = (time * 0.6 + i * 0.37) % 1;
        px(X + 6 + i * 10, Y + 8 + i * 6, 3 + Math.round(k * 3), 1, `rgba(255,255,255,${0.7 * (1 - k)})`);
      }
    },
  });
  // Banc en rondin face au lac
  furniture.push({
    base: LOUNGE.log.y * T + 7.5,
    draw: () => {
      const x = LOUNGE.log.blocks[0] * T;
      const y = LOUNGE.log.y * T + 3;
      const w = (LOUNGE.log.blocks[LOUNGE.log.blocks.length - 1] - LOUNGE.log.blocks[0] + 1) * T;
      box(x, y, w, 7, '#a86d36', '#c98a4b', '#7a4a22');
      box(x - 2, y, 5, 7, '#e0b07a');
      px(x - 1, y + 2, 3, 3, '#c98a4b');
      px(x + 10, y + 3, 6, 1, '#7a4a22');
      px(x + 26, y + 3, 5, 1, '#7a4a22');
    },
  });
  // Fleurs isolées (balancement) et herbes hautes qui cachent les pieds des promeneurs
  const FLOWERS = [[34, 17], [44, 19], [37, 23]];
  for (const [fx, fy] of FLOWERS) {
    furniture.push({
      base: fy * T,
      draw: (time) => {
        const sway = reduced() ? 0 : Math.round(Math.sin(time * 2 + fx));
        for (const [ox, oy, c] of [[2, 3, '#e2504f'], [5, 5, '#ffffff']]) {
          const X = fx * T + /** @type {number} */ (ox);
          const Y = fy * T + /** @type {number} */ (oy);
          px(X, Y + 1, 1, 3, '#3d8b3d');
          px(X - 1 + sway, Y - 1, 3, 3, /** @type {string} */ (c));
          px(X + sway, Y, 1, 1, '#f2a03a');
        }
      },
    });
  }
  const TALL_GRASS = [[31, 21], [31, 22], [45, 21], [45, 22]];
  for (const [gx, gy] of TALL_GRASS) {
    furniture.push({
      base: (gy + 1) * T - 0.5,
      draw: (time) => {
        const X = gx * T;
        const Y = gy * T;
        const sway = reduced() ? 0 : Math.round(Math.sin(time * 1.5 + gx + gy) * 0.6);
        for (const ox of [0, 4]) {
          px(X + ox + sway, Y + 3, 1, 1, O);
          px(X + ox + 3 + sway, Y + 3, 1, 1, O);
          px(X + ox, Y + 4, 4, 4, '#3f9a4e');
          px(X + ox + 1 + sway, Y + 4, 1, 2, '#6cc46a');
          px(X + ox + sway, Y + 4, 1, 1, '#2f7f45');
          px(X + ox + 3 + sway, Y + 4, 1, 1, '#2f7f45');
          px(X + ox, Y + 7, 4, 1, '#2f7f45');
        }
      },
    });
  }
  // Arbres
  const TREE = [
    '.......oo.......', '......oLLo......', '.....oLlLLo.....', '....oLLLLLLo....', '...oLLDLLlLLo...', '....ooLLLLoo....',
    '....oLLLlLLo....', '...oLlLLLLLLo...', '..oLLDLLLLDLLo..', '.oLLLLLLLLLLLLo.', '..oooLLLLLLooo..', '...oLLLlLLLLo...',
    '..oLlLLLLLLLLo..', '.oLLDLLLLLLDLLo.', 'oLLLLLLLlLLLLLLo', 'oDLLLLLLLLLLLLDo', '.oDDLLLLLLLLDDo.', '..ooDDDDDDDDoo..',
    '......oTTo......', '......oTTo......', '.....oTTTTo.....', '......oooo......',
  ];
  const TREE_PAL = { o: O, L: '#4fae5f', l: '#86d67a', D: '#2f7f45', T: '#8a5a3a' };
  for (const tr of LOUNGE.trees) {
    furniture.push({
      base: (tr.y + 2) * T,
      draw: () => {
        ctx.fillStyle = 'rgba(43, 34, 54, 0.2)';
        ctx.fillRect(tr.x * T + 1, (tr.y + 2) * T - 4, 14, 4);
        ctx.drawImage(sprite(TREE, TREE_PAL, 'tree'), tr.x * T, (tr.y + 2) * T - 22 - 6);
      },
    });
  }
  // Hamac tendu entre les deux arbres de droite
  furniture.push({
    base: LOUNGE.hammock.y * T + 7.5,
    draw: () => {
      const x = (LOUNGE.hammock.x - 1) * T + 4;
      const y = LOUNGE.hammock.y * T;
      px(x - 1, y - 4, 1, 6, O);
      px(x + 16, y - 4, 1, 6, O);
      px(x, y + 1, 16, 6, O);
      px(x + 1, y + 2, 14, 4, '#f2c03a');
      px(x + 2, y + 3, 12, 1, '#e2504f');
      px(x + 3, y + 7, 10, 1, O);
    },
  });
  const BUSH = ['..oooooo..', '.oLLlLLLo.', 'oLLLLLlLLo', 'oLDLLLLDLo', 'oLLLLLLLLo', '.oDDLLDDo.', '..oooooo..'];
  for (const bu of LOUNGE.bushes) {
    furniture.push({
      base: (bu.y + 1) * T,
      draw: () => {
        ctx.drawImage(sprite(BUSH, TREE_PAL, 'bush'), bu.x * T - 1, bu.y * T + 1);
        px(bu.x * T + 2, bu.y * T + 2, 1, 1, '#e2504f');
        px(bu.x * T + 6, bu.y * T + 4, 1, 1, '#ffd23f');
      },
    });
  }
  for (const p of [...OPEN_PLANTS, ...BIG_PLANTS]) {
    furniture.push({ base: (p.y + 1) * T, draw: () => ctx.drawImage(sprite(PLANT, PLANT_PAL, 'plant'), p.x * T - 2, p.y * T - 8) });
  }
  // Corbeilles de l'open space
  for (const [x, y] of BINS) {
    furniture.push({
      base: (y + 1) * T,
      draw: () => {
        box(x * T + 1, y * T, 7, 8, '#8a93a6', '#b9c3d3');
        px(x * T + 3, y * T - 1, 3, 2, C.white);
      },
    });
  }

  function draw(/** @type {number} */ t) {
    ctx.drawImage(bg, 0, 0);
    /** @type {(() => void)[]} */
    const bubbles = [];
    const items = [
      ...furniture,
      ...[...people.values()].map((p) => {
        const tile = tileOf(p);
        const side = p.pose === 'sit' ? sideSeatBase.get(`${tile.x},${tile.y}`) : undefined;
        return {
          base: side !== undefined ? side + p.y / 1000 : p.y,
          draw: (/** @type {number} */ tt) => {
            const b = drawPerson(p, tt);
            if (b) {
              bubbles.push(b);
            }
          },
        };
      }),
    ];
    items.sort((a, b) => a.base - b.base);
    for (const it of items) {
      it.draw(t);
    }
    for (const b of bubbles) {
      b();
    }
  }

  // ======================================================================
  // Boucle
  // ======================================================================
  let last = performance.now();
  function frame(/** @type {number} */ now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      if (reduced()) {
        placeStatic();
      } else {
        step(dt);
      }
      draw(now / 1000);
    }
    // En mode réduit, la scène est statique : une image par seconde suffit.
    if (reduced()) {
      setTimeout(() => requestAnimationFrame(frame), 1000);
    } else {
      requestAnimationFrame(frame);
    }
  }
  requestAnimationFrame(frame);

  // ======================================================================
  // Bandeau, liste et pied de page
  // ======================================================================
  function renderText(/** @type {any} */ summary) {
    const banner = /** @type {HTMLElement} */ (document.getElementById('banner'));
    banner.className = `banner banner--${summary.kind}`;
    /** @type {HTMLElement} */ (document.getElementById('banner-text')).textContent = summary.text;

    const roster = /** @type {HTMLElement} */ (document.getElementById('roster'));
    roster.replaceChildren(
      ...snapshot.slots.map((/** @type {any} */ slot, /** @type {number} */ i) => {
        const li = document.createElement('li');
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = `${i + 1}.`;
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'name';
        const state = document.createElement('span');
        state.className = 'state';
        if (!slot.agent) {
          li.className = 'is-empty';
          name.textContent = 'Free desk';
        } else {
          const a = slot.agent;
          li.className = `is-${a.state}`;
          const p = people.get(a.id);
          if (p) {
            sw.style.background = p.color;
          }
          name.textContent = a.name;
          state.textContent = stateLabel(a.state) + (a.updatedAt ? ` · ${fmtTime(a.updatedAt)}` : '');
          if (a.runtime !== 'claude-code') {
            state.textContent += ` · ${a.runtime}`;
          }
        }
        li.append(num, sw, name, state);
        return li;
      }),
    );

    const footer = /** @type {HTMLElement} */ (document.getElementById('footer'));
    const lines = [];
    if (snapshot.overflow.length) {
      const desc = snapshot.overflow.map((/** @type {any} */ a) => `${a.name} (${stateLabel(a.state)})`).join(', ');
      lines.push(`${snapshot.overflow.length} more agent(s) found beyond the ten desks: ${desc}.`);
    }
    for (const h of snapshot.health) {
      if (h.message) {
        lines.push(h.message);
      }
    }
    for (const n of snapshot.notices) {
      lines.push(n);
    }
    lines.push(
      `Last update: ${fmtTime(snapshot.generatedAt)}. Working at a desk, visits, meetings and hand-ins reflect real signals (status and delegations); the hammock, the pond and chats are just for fun.`,
    );
    footer.replaceChildren(
      ...lines.map((l) => {
        const p = document.createElement('p');
        p.textContent = l;
        return p;
      }),
    );
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'snapshot') {
      snapshot = msg.snapshot;
      sync();
      renderText(msg.summary);
    } else if (msg && msg.type === 'motion') {
      reduceMotionSetting = msg.reduceMotion;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
