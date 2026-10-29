import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { definitionSources, discoverDefinitions, parseFrontmatter } from '../discovery/agentDefinitions';
import { ClaudeCodeAdapter, projectDirName } from '../runtime/claudeCode';
import { readCopilot } from '../runtime/copilot';
import { normalize } from '../state/normalize';
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
