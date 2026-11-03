import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { DEFAULT_AGENT, definitionSources, discoverDefinitions, parseFrontmatter, withDefaultAgent } from '../discovery/agentDefinitions';
import { panelSetting, resolveSettings } from '../core/settings';
import { addProjectFolder, dropRecent, MAX_RECENTS, projectFolders, pushRecent, readSettingsFile, readState, writeSetting, writeState } from '../standalone/store';
import { ClaudeCodeAdapter, cwdMatcher, modelLabel, projectDirName } from '../runtime/claudeCode';
import { readCopilot } from '../runtime/copilot';
import { normalize } from '../state/normalize';
import { winterDecor } from '../state/season';
import { roleOf } from '../state/placement';
import { assignSlots } from '../state/slots';
import { buildSnapshot } from '../state/snapshot';
import { summarize } from '../state/summary';
import { AgentDefinition, RuntimeReport } from '../types';

const NOW = 1_800_000_000_000;

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
}
function write(file: string, content: string, mtime?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mtime) {
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
  }
}
const def = (name: string, runtime: AgentDefinition['runtime'] = 'claude-code'): AgentDefinition => ({
  id: `${runtime}:${name}`,
  name,
  runtime,
  scope: 'user',
});
const okClaude = (signals: RuntimeReport['signals'] = []): RuntimeReport => ({
  health: { runtime: 'claude-code', status: 'ok' },
  signals,
});

test('parseFrontmatter lit name et color seulement', () => {
  assert.deepEqual(parseFrontmatter('---\nname: tech-lead\ncolor: "blue"\ntools: Read\n---\nCorps'), {
    name: 'tech-lead',
    color: 'blue',
  });
  assert.deepEqual(parseFrontmatter('pas de frontmatter'), {});
  assert.deepEqual(parseFrontmatter('---\nname: helper\ndescription: >\n  Turns ideas into\n  wireframes.\nmodel: opus\n---\n'), {
    name: 'helper',
    description: 'Turns ideas into wireframes.',
  });
});

test('découverte : utilisateur + projet, le projet prime, dossiers absents ignorés', async () => {
  const home = tmp();
  const ws = tmp();
  write(path.join(home, '.claude/agents/a.md'), '---\nname: alpha\n---\n');
  write(path.join(home, '.claude/agents/b.md'), '---\nname: beta\ncolor: red\n---\n');
  write(path.join(ws, '.claude/agents/b2.md'), '---\nname: beta\ncolor: green\n---\n');
  write(path.join(ws, '.github/agents/reviewer.agent.md'), 'sans frontmatter');
  const result = await discoverDefinitions(definitionSources(path.join(home, '.claude'), home, [ws]));
  assert.equal(result.errors.length, 0);
  const byId = Object.fromEntries(result.definitions.map((d) => [d.id, d]));
  assert.deepEqual(Object.keys(byId).sort(), ['claude-code:alpha', 'claude-code:beta', 'copilot:reviewer']);
  assert.equal(byId['claude-code:beta'].scope, 'project');
  assert.equal(byId['claude-code:beta'].color, 'green');
  assert.equal(byId['claude-code:beta'].file, path.join(ws, '.claude/agents/b2.md'));
});

function claudeFixture() {
  const dir = tmp();
  const cwd = '/Users/x/projet';
  const proj = path.join(dir, 'projects', projectDirName(cwd));
  const session = (pid: number, id: string, status: string) =>
    write(path.join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: id, cwd, status, updatedAt: NOW - 1000 }));
  return { dir, proj, session };
}

test('Claude Code : session vivante occupée avec agent principal → actif ; morte → ignorée', async () => {
  const { dir, proj, session } = claudeFixture();
  session(100, 's-live', 'busy');
  session(200, 's-dead', 'busy');
  session(300, 's-idle', 'idle');
  write(path.join(proj, 's-live.jsonl'), '{"type":"agent-setting","agentSetting":"product-manager"}\n{"type":"user"}\n');
  write(path.join(proj, 's-dead.jsonl'), '{"type":"agent-setting","agentSetting":"qa-engineer"}\n');
  write(path.join(proj, 's-idle.jsonl'), '{"type":"agent-setting","agentSetting":"tech-lead"}\n');
  const adapter = new ClaudeCodeAdapter({
    claudeDir: dir,
    subagentSilenceMs: 60_000,
    now: () => NOW,
    isPidAlive: (pid) => pid !== 200,
  });
  const report = await adapter.read();
  assert.equal(report.health.status, 'ok');
  const states = Object.fromEntries(report.signals.map((s) => [s.agentName, s.state]));
  assert.deepEqual(states, { 'product-manager': 'active', 'tech-lead': 'idle' });
  // Limité aux dossiers d'un projet : les sessions lancées ailleurs ne sont pas lues.
  assert.equal((await adapter.read(['/Users/x/projet'])).signals.length, 2);
  assert.equal((await adapter.read(['/Users/x/autre'])).signals.length, 0);
});

test('Claude Code : sous-agents non terminés actifs, terminés ignorés, silencieux inconnus', async () => {
  const { dir, proj, session } = claudeFixture();
  session(100, 's1', 'idle');
  write(path.join(proj, 's1.jsonl'), '{"type":"user"}\n');
  const sub = path.join(proj, 's1', 'subagents');
  write(path.join(sub, 'agent-a.meta.json'), JSON.stringify({ agentType: 'tech-lead' }));
  write(path.join(sub, 'agent-a.jsonl'), '{}', NOW - 5_000);
  write(path.join(sub, 'agent-b.meta.json'), JSON.stringify({ agentType: 'qa-engineer', finished: true }));
  write(path.join(sub, 'agent-b.jsonl'), '{}', NOW - 5_000);
  write(path.join(sub, 'agent-c.meta.json'), JSON.stringify({ agentType: 'ux-ui-designer' }));
  write(path.join(sub, 'agent-c.jsonl'), '{}', NOW - 30 * 60_000);
  write(path.join(sub, 'agent-d.meta.json'), JSON.stringify({ agentType: 'developer-backend' }));
  write(path.join(sub, 'agent-d.jsonl'), '{}', NOW - 24 * 3600_000);
  const adapter = new ClaudeCodeAdapter({
    claudeDir: dir,
    subagentSilenceMs: 20 * 60_000,
    now: () => NOW,
    isPidAlive: () => true,
  });
  const report = await adapter.read();
  const states = Object.fromEntries(report.signals.map((s) => [s.agentName, s.state]));
  assert.deepEqual(states, { 'tech-lead': 'active', 'ux-ui-designer': 'unknown' });
  // Une instance par sous-agent non terminé et non expiré, pour les mini-bots.
  const runs = (report.subagents ?? []).map((r) => [r.id, r.agentType, r.state]).sort();
  assert.deepEqual(runs, [
    ['s1/agent-a', 'tech-lead', 'active'],
    ['s1/agent-c', 'ux-ui-designer', 'unknown'],
  ]);
});

test('mini-bots : sous-agents sans personnage, instances en plus, plafond et résumé', () => {
  const run = (id: string, agentType: string, startedAt: number, state: 'active' | 'unknown' = 'active') => ({
    id,
    agentType,
    state,
    startedAt,
  });
  const report: RuntimeReport = {
    ...okClaude([{ runtime: 'claude-code', agentName: 'tech-lead', state: 'active', observedAt: NOW }]),
    subagents: [
      run('s/b', 'tech-lead', NOW - 2_000),
      run('s/a', 'tech-lead', NOW - 5_000),
      run('s/c', 'Explore', NOW - 1_000, 'unknown'),
    ],
  };
  const snap = buildSnapshot([def('tech-lead')], [report], NOW);
  // La première instance de tech-lead est son personnage ; la seconde et l'agent intégré sont des mini-bots.
  assert.deepEqual(snap.helpers.map((h) => [h.id, h.name, h.state]), [
    ['s/b', 'tech-lead', 'active'],
    ['s/c', 'Explore', 'unknown'],
  ]);
  assert.equal(snap.helperOverflow, 0);
  assert.equal(summarize(snap).text, 'Active agent: tech-lead + 2 subagents');

  const crowd: RuntimeReport = {
    ...okClaude(),
    subagents: Array.from({ length: 11 }, (_, i) => run(`s/${i}`, 'general-purpose', NOW - 20_000 + i)),
  };
  const full = buildSnapshot([def('pm')], [crowd], NOW);
  assert.equal(full.helpers.length, 8);
  assert.equal(full.helpers[0].id, 's/0'); // les plus anciens restent dans le bureau
  assert.equal(full.helperOverflow, 3);
  const sum = summarize(full);
  assert.equal(sum.kind, 'active');
  assert.equal(sum.text, '11 subagents working');
});

test('Claude par défaut : session sans agent → « Claude » avec son modèle, et ses délégations', async () => {
  const { dir, proj, session } = claudeFixture();
  session(100, 's-claude', 'busy');
  session(200, 's-pm', 'idle');
  write(
    path.join(proj, 's-claude.jsonl'),
    '{"type":"user"}\n{"message":{"model":"claude-sonnet-5-5"}}\n{"message":{"model":"claude-opus-5-5"}}\n{"message":{"model":"<synthetic>"}}\n',
  );
  write(path.join(proj, 's-pm.jsonl'), '{"type":"agent-setting","agentSetting":"product-manager"}\n{"message":{"model":"claude-opus-5-5"}}\n');
  const sub = path.join(proj, 's-claude', 'subagents');
  write(path.join(sub, 'agent-a.meta.json'), JSON.stringify({ agentType: 'tech-lead', spawnDepth: 1 }));
  write(path.join(sub, 'agent-a.jsonl'), '{}', NOW - 5_000);
  const options = { claudeDir: dir, subagentSilenceMs: 60_000, now: () => NOW, isPidAlive: () => true };

  const report = await new ClaudeCodeAdapter({ ...options, defaultAgent: DEFAULT_AGENT }).read();
  const main = Object.fromEntries(report.signals.map((s) => [s.agentName, [s.state, s.model]]));
  assert.deepEqual(main, {
    Claude: ['active', 'Opus 5.5'],
    'product-manager': ['idle', undefined],
    'tech-lead': ['active', undefined],
  });
  assert.deepEqual(report.delegations?.map((d) => [d.from, d.to]), [['Claude', 'tech-lead']]);

  // Réglage désactivé : comportement d'avant, la session sans agent est ignorée.
  const off = await new ClaudeCodeAdapter(options).read();
  assert.ok(!off.signals.some((s) => s.agentName === DEFAULT_AGENT));
  assert.equal(off.delegations?.length, 0);

  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
});

test('Claude par défaut : toujours représenté, bureau du PM seulement s\'il est libre', () => {
  const names = Array.from({ length: 10 }, (_, i) => `dev-${i}`);
  const crowded = buildSnapshot(withDefaultAgent(names.map((n) => def(n))), [okClaude()], NOW);
  assert.equal(crowded.slots[0].agent?.name, DEFAULT_AGENT);
  assert.equal(crowded.slots[0].agent?.builtin, true);
  assert.deepEqual(crowded.overflow.map((a) => a.name), ['dev-9']);

  const alone = buildSnapshot(withDefaultAgent([def('dev')]), [okClaude()], NOW);
  const ws = (snap: typeof alone) =>
    Object.fromEntries(snap.slots.filter((s) => s.agent).map((s) => [s.agent!.name, s.workstation]));
  assert.equal(ws(alone)[DEFAULT_AGENT], 'office-pm');
  const withPm = buildSnapshot(withDefaultAgent([def('product-manager')]), [okClaude()], NOW);
  assert.equal(ws(withPm)['product-manager'], 'office-pm');
  assert.match(String(ws(withPm)[DEFAULT_AGENT]), /^open-/);

  // Un agent défini nommé « Claude » garde la place : pas de doublon.
  assert.equal(withDefaultAgent([def(DEFAULT_AGENT)]).length, 1);
});

test('Claude Code : registre des sessions absent → source indisponible', async () => {
  const adapter = new ClaudeCodeAdapter({ claudeDir: tmp(), subagentSilenceMs: 1 });
  const report = await adapter.read();
  assert.equal(report.health.status, 'unavailable');
});

test('normalisation : actif > inconnu > inactif ; source indisponible → inconnu', () => {
  const defs = [def('a'), def('b'), def('c'), def('cop', 'copilot')];
  const statuses = normalize(defs, [
    okClaude([
      { runtime: 'claude-code', agentName: 'a', state: 'idle', observedAt: 1 },
      { runtime: 'claude-code', agentName: 'a', state: 'active', observedAt: 2 },
      { runtime: 'claude-code', agentName: 'b', state: 'unknown', observedAt: 3 },
      { runtime: 'claude-code', agentName: 'Explore', state: 'active', observedAt: 4 },
    ]),
    readCopilot(),
  ]);
  assert.deepEqual(
    statuses.map((s) => [s.name, s.state, s.updatedAt]),
    [['a', 'active', 2], ['b', 'unknown', 3], ['c', 'inactive', undefined], ['cop', 'unknown', undefined]],
  );
  const down = normalize([def('a')], [{ health: { runtime: 'claude-code', status: 'unavailable' }, signals: [] }]);
  assert.equal(down[0].state, 'unknown');
});

test('emplacements : exactement dix, ordre alphabétique stable, épinglés en tête, débordement', () => {
  const names = ['zeta', 'alpha', 'Beta', 'gamma', 'delta', 'eps', 'eta', 'theta', 'iota', 'kappa', 'lambda'];
  const statuses = normalize(names.map((n) => def(n)), [okClaude()]);
  const { slots, overflow } = assignSlots(statuses);
  assert.equal(slots.length, 10);
  assert.deepEqual(
    slots.map((s) => s.agent?.name),
    ['alpha', 'Beta', 'delta', 'eps', 'eta', 'gamma', 'iota', 'kappa', 'lambda', 'theta'],
  );
  assert.deepEqual(overflow.map((a) => a.name), ['zeta']);
  const pinned = assignSlots(statuses, ['zeta']);
  assert.equal(pinned.slots[0].agent?.name, 'zeta');
  assert.deepEqual(pinned.overflow.map((a) => a.name), ['theta']);

  const few = assignSlots(normalize([def('solo')], [okClaude()]));
  assert.equal(few.slots.length, 10);
  assert.equal(few.slots.filter((s) => s.agent).length, 1);
});

test('pièces : rôles déduits du nom, bureaux individuels, open space, réglage prioritaire', () => {
  assert.equal(roleOf('product-manager'), 'pm');
  assert.equal(roleOf('product-challenger'), 'challenger');
  assert.equal(roleOf('ux-ui-designer'), 'design');
  assert.equal(roleOf('developer-frontend'), 'engineering');
  assert.equal(roleOf('qa-engineer'), 'engineering');
  assert.equal(roleOf('administrateur', { administrateur: 'pm' }), 'pm');

  // Nom muet : la description décide ; le premier mot-clé rencontré l'emporte.
  assert.equal(roleOf('alice', {}, 'Acts as the product manager and talks to the designer.'), 'pm');
  assert.equal(roleOf('bob', {}, "Plays devil's advocate on every product idea."), 'challenger');
  assert.equal(roleOf('carol', {}, 'Draws wireframes and checks the UX of each screen.'), 'design');
  assert.equal(roleOf('dave', {}, 'Writes migrations.'), 'engineering');
  assert.equal(roleOf('dave'), 'engineering');
  // Nom technique : la description n'est pas consultée.
  assert.equal(roleOf('developer-frontend', {}, 'Builds the UI from the mockups.'), 'engineering');

  const team = [
    'administrateur', 'developer-backend', 'developer-frontend', 'documentation-engineer',
    'product-challenger', 'product-manager', 'qa-engineer', 'tech-lead', 'ux-ui-designer',
  ];
  const snap = buildSnapshot(team.map((n) => def(n)), [okClaude()], NOW);
  const ws = Object.fromEntries(snap.slots.filter((s) => s.agent).map((s) => [s.agent!.name, s.workstation]));
  assert.equal(snap.overflow.length, 0);
  assert.equal(ws['product-manager'], 'office-pm');
  assert.equal(ws['product-challenger'], 'office-challenger');
  assert.equal(ws['ux-ui-designer'], 'office-design');
  for (const n of ['administrateur', 'developer-backend', 'developer-frontend', 'documentation-engineer', 'qa-engineer', 'tech-lead']) {
    assert.match(String(ws[n]), /^open-/);
  }
  assert.equal(new Set(Object.values(ws)).size, team.length);

  // Agents aux noms muets : la description leur attribue un bureau individuel.
  const generic = buildSnapshot(
    [
      { ...def('alice'), description: 'Product owner of the team.' },
      { ...def('bob'), description: 'Challenges every idea.' },
      { ...def('carol'), description: 'UX designer.' },
      def('dave'),
    ],
    [okClaude()],
    NOW,
  );
  const gws = Object.fromEntries(generic.slots.filter((s) => s.agent).map((s) => [s.agent!.name, s.workstation]));
  assert.deepEqual(gws, { alice: 'office-pm', bob: 'office-challenger', carol: 'office-design', dave: 'open-1' });
  // La description ne part jamais vers la vue.
  assert.ok(!JSON.stringify(generic).includes('Product owner'));

  // Dix ingénieurs : sept postes en open space puis les bureaux libres en appoint.
  const many = buildSnapshot(Array.from({ length: 10 }, (_, i) => def(`dev-${i}`)), [okClaude()], NOW);
  const used = many.slots.map((s) => s.workstation);
  assert.equal(new Set(used).size, 10);
  assert.ok(used.includes('office-pm'));
});

test('délégations : lancement et fin réels, transmises seulement entre agents représentés', async () => {
  const { dir, proj, session } = claudeFixture();
  session(100, 's1', 'idle');
  write(path.join(proj, 's1.jsonl'), '{"type":"agent-setting","agentSetting":"product-manager"}\n');
  const sub = path.join(proj, 's1', 'subagents');
  write(path.join(sub, 'agent-a.meta.json'), JSON.stringify({ agentType: 'tech-lead', spawnDepth: 1 }));
  write(path.join(sub, 'agent-a.jsonl'), '{}', NOW - 5_000);
  write(path.join(sub, 'agent-b.meta.json'), JSON.stringify({ agentType: 'qa-engineer', spawnDepth: 1, finished: true }), NOW - 60_000);
  write(path.join(sub, 'agent-b.jsonl'), '{}', NOW - 60_000);
  write(path.join(sub, 'agent-c.meta.json'), JSON.stringify({ agentType: 'qa-engineer', finished: true }), NOW - 3600_000);
  write(path.join(sub, 'agent-c.jsonl'), '{}', NOW - 3600_000);
  write(path.join(sub, 'agent-d.meta.json'), JSON.stringify({ agentType: 'Explore', spawnDepth: 1 }));
  write(path.join(sub, 'agent-d.jsonl'), '{}', NOW - 5_000);
  const adapter = new ClaudeCodeAdapter({ claudeDir: dir, subagentSilenceMs: 60_000, now: () => NOW, isPidAlive: () => true });
  const report = await adapter.read();
  const dl = (report.delegations ?? []).map((d) => [d.from, d.to, d.finishedAt !== undefined]).sort();
  assert.deepEqual(dl, [
    ['product-manager', 'Explore', false],
    ['product-manager', 'qa-engineer', true],
    ['product-manager', 'tech-lead', false],
  ]);
  const snap = buildSnapshot(['product-manager', 'tech-lead', 'qa-engineer'].map((n) => def(n)), [report], NOW);
  assert.deepEqual(snap.interactions.map((i) => i.to).sort(), ['qa-engineer', 'tech-lead']);
  const pm = snap.slots.find((s) => s.agent?.name === 'product-manager');
  assert.equal(pm?.agent?.state, 'inactive');
});

test('décor de saison : l\'hiver du 1er décembre au 6 janvier, jamais s\'il est coupé', () => {
  const on = (iso: string) => winterDecor(true, new Date(`${iso}T12:00:00`));
  assert.equal(on('2026-11-30'), false);
  assert.equal(on('2026-12-01'), true);
  assert.equal(on('2026-12-31'), true);
  assert.equal(on('2027-01-06'), true);
  assert.equal(on('2027-01-07'), false);
  assert.equal(winterDecor(false, new Date('2026-12-25T12:00:00')), false);
});

test('résumé : un, plusieurs, aucun, inconnu, source indisponible', () => {
  const sig = (agentName: string, state: 'active' | 'idle' | 'unknown') => ({
    runtime: 'claude-code' as const,
    agentName,
    state,
    observedAt: NOW,
  });
  const defs = [def('pm'), def('qa')];
  const one = summarize(buildSnapshot(defs, [okClaude([sig('pm', 'active')])], NOW));
  assert.equal(one.text, 'Active agent: pm');
  const two = summarize(buildSnapshot(defs, [okClaude([sig('pm', 'active'), sig('qa', 'active')])], NOW));
  assert.equal(two.text, '2 active agents: pm, qa');
  const none = summarize(buildSnapshot(defs, [okClaude()], NOW));
  assert.equal(none.text, 'No active agents');
  const unknown = summarize(buildSnapshot(defs, [okClaude([sig('qa', 'unknown')])], NOW));
  assert.equal(unknown.kind, 'unknown');
  assert.notEqual(unknown.text, 'No active agents');
  const down = summarize(
    buildSnapshot(defs, [{ health: { runtime: 'claude-code', status: 'unavailable' }, signals: [] }], NOW),
  );
  assert.equal(down.kind, 'unknown');
  const empty = summarize(buildSnapshot([], [okClaude()], NOW));
  assert.equal(empty.text, 'No agents found');
});

test('resolveSettings: defaults, bounds and invalid values', () => {
  const home = '/home/me';
  const d = resolveSettings({}, {}, home);
  assert.equal(d.claudeDir, path.join(home, '.claude'));
  assert.equal(d.pollMs, 2000);
  assert.equal(d.silenceMs, 20 * 60_000);
  assert.equal(d.showClaude, true);
  assert.equal(d.seasonal, true);
  assert.equal(d.sessionScope, 'project');
  assert.equal(resolveSettings({ christmasDecor: 'off' }, {}, home).seasonal, false);
  assert.equal(resolveSettings({ christmasDecor: 'off', seasonalDecor: true }, {}, home).seasonal, true);
  assert.equal(resolveSettings({ sessionScope: 'all' }, {}, home).sessionScope, 'all');
  assert.equal(resolveSettings({}, { CLAUDE_CONFIG_DIR: '/env' }, home).claudeDir, '/env');
  assert.equal(resolveSettings({ claudeConfigDir: ' /set ' }, { CLAUDE_CONFIG_DIR: '/env' }, home).claudeDir, '/set');
  assert.equal(resolveSettings({ pollIntervalSeconds: 0 }, {}, home).pollMs, 1000);
  assert.equal(resolveSettings({ pollIntervalSeconds: 999 }, {}, home).pollMs, 60_000);
  const bad = resolveSettings({ pollIntervalSeconds: 'x', pinnedAgents: ['a', 3], agentRooms: { a: 'design', b: 1 }, christmasDecor: 'maybe' }, {}, home);
  assert.equal(bad.pollMs, 2000);
  assert.deepEqual(bad.pinned, ['a']);
  assert.deepEqual(bad.rooms, { a: 'design' });
  assert.equal(bad.seasonal, true);
});

test('roue crantée : seules ses clés et leurs valeurs prévues sont acceptées', () => {
  assert.deepEqual(panelSetting('sessionScope', 'all'), { key: 'sessionScope', value: 'all' });
  assert.deepEqual(panelSetting('subagentSilenceMinutes', 5), { key: 'subagentSilenceMinutes', value: 5 });
  assert.deepEqual(panelSetting('seasonalDecor', false), { key: 'seasonalDecor', value: false });
  assert.equal(panelSetting('sessionScope', 'mine'), undefined);
  assert.equal(panelSetting('subagentSilenceMinutes', 7), undefined);
  assert.equal(panelSetting('showDefaultClaude', 'yes'), undefined);
  assert.equal(panelSetting('claudeConfigDir', '/tmp'), undefined);
  assert.equal(panelSetting('__proto__', true), undefined);
});

test('portée : dossier du projet et sous-dossiers, pas les dossiers voisins', () => {
  const inScope = cwdMatcher(['/work/app', '/work/lib'], 'darwin');
  assert.equal(inScope('/work/app'), true);
  assert.equal(inScope('/work/app/.claude/worktrees/x'), true);
  assert.equal(inScope('/WORK/Lib'), true);
  assert.equal(inScope('/work/app-2'), false);
  assert.equal(inScope('/work'), false);
  assert.equal(inScope(undefined), false);
  assert.equal(cwdMatcher(['/work/app'], 'linux')('/WORK/app'), false);
});

test('standalone settings file: missing, invalid, and adding a project folder', () => {
  const dir = tmp();
  const file = path.join(dir, 'sub', 'settings.json');
  assert.deepEqual(readSettingsFile(file), {});
  addProjectFolder(file, '/work/a');
  addProjectFolder(file, '/work/a');
  addProjectFolder(file, '/work/b');
  assert.deepEqual(projectFolders(readSettingsFile(file)), ['/work/a', '/work/b']);
  // Un réglage de la roue crantée garde les autres clés ; l'ancien décor coupé devient `seasonalDecor: false`.
  fs.writeFileSync(file, JSON.stringify({ projectFolders: ['/work/a'], christmasDecor: 'off', pinnedAgents: ['pm'] }));
  writeSetting(file, 'sessionScope', 'all');
  const saved = readSettingsFile(file);
  assert.equal(saved.sessionScope, 'all');
  assert.equal(saved.seasonalDecor, false);
  assert.equal(saved.christmasDecor, undefined);
  assert.deepEqual(saved.pinnedAgents, ['pm']);
  assert.deepEqual(projectFolders(saved), ['/work/a']);
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(readSettingsFile(file), {});
  fs.writeFileSync(file, '[1]');
  assert.deepEqual(readSettingsFile(file), {});
});

test('standalone recents: most recent first, no duplicates, bounded, removable, persisted', () => {
  let state = readState(path.join(tmp(), 'missing.json'));
  assert.deepEqual(state, { recents: [] });
  state = pushRecent(pushRecent(pushRecent(state, '/work/a'), '/work/b'), '/work/a');
  assert.deepEqual(state.recents, [path.resolve('/work/a'), path.resolve('/work/b')]);
  assert.equal(state.lastFolder, path.resolve('/work/a'));
  for (let i = 0; i < MAX_RECENTS + 5; i++) {
    state = pushRecent(state, `/work/p${i}`);
  }
  assert.equal(state.recents.length, MAX_RECENTS);
  state = dropRecent(state, path.resolve(`/work/p${MAX_RECENTS + 4}`));
  assert.equal(state.recents[0], path.resolve(`/work/p${MAX_RECENTS + 3}`));
  assert.equal(state.lastFolder, state.recents[0]);
  const file = path.join(tmp(), 'sub', 'state.json');
  writeState(file, state);
  assert.deepEqual(readState(file), state);
  fs.writeFileSync(file, '{ nope');
  assert.deepEqual(readState(file), { recents: [] });
});
