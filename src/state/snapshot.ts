import { AgentDefinition, HELPER_COUNT, Helper, Interaction, OfficeSnapshot, RuntimeReport } from '../types';
import { normalize } from './normalize';
import { placeAgents } from './placement';
import { assignSlots } from './slots';

export interface SnapshotOptions {
  pinned?: string[];
  rooms?: Record<string, string>;
  notices?: string[];
}

export function buildSnapshot(
  definitions: AgentDefinition[],
  reports: RuntimeReport[],
  now: number,
  options: SnapshotOptions = {},
): OfficeSnapshot {
  const statuses = normalize(definitions, reports);
  const { slots, overflow } = assignSlots(statuses, options.pinned ?? []);
  const descriptions = new Map(definitions.flatMap((d) => (d.description ? [[d.id, d.description] as const] : [])));
  const placed = placeAgents(
    slots.flatMap((s) => (s.agent ? [s.agent] : [])),
    options.rooms,
    descriptions,
  );
  for (const slot of slots) {
    if (slot.agent) {
      slot.workstation = placed.get(slot.agent.id);
    }
  }

  // Interactions limitées aux agents représentés dans le bureau, et au même runtime.
  const shown = new Map(slots.flatMap((s) => (s.agent ? [[s.agent.id, s.agent] as const] : [])));
  const interactions: Interaction[] = [];
  for (const report of reports) {
    for (const d of report.delegations ?? []) {
      const from = `${d.runtime}:${d.from}`;
      const to = `${d.runtime}:${d.to}`;
      if (shown.has(from) && shown.has(to) && from !== to) {
        interactions.push({ id: d.id, from: d.from, to: d.to, startedAt: d.startedAt, finishedAt: d.finishedAt });
      }
    }
  }

  // Mini-bots : un par sous-agent en cours, sauf la première instance d'un agent représenté (son personnage).
  // Les plus anciens restent dans le bureau ; les suivants attendent derrière la porte.
  const helpers: Helper[] = [];
  for (const report of reports) {
    const embodied = new Set<string>();
    const runs = [...(report.subagents ?? [])].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    for (const run of runs) {
      const agentId = `${report.health.runtime}:${run.agentType}`;
      if (shown.has(agentId) && !embodied.has(agentId)) {
        embodied.add(agentId);
        continue;
      }
      helpers.push({ id: run.id, name: run.agentType, state: run.state, startedAt: run.startedAt });
    }
  }
  helpers.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));

  // Seuls les runtimes qui ont au moins une définition sont pertinents pour l'affichage.
  const runtimes = new Set(definitions.map((d) => d.runtime));
  const health = reports
    .map((r) => r.health)
    .filter((h) => runtimes.has(h.runtime) || (definitions.length === 0 && h.runtime === 'claude-code'));
  return {
    slots,
    overflow,
    discoveredCount: statuses.length,
    health,
    notices: options.notices ?? [],
    interactions,
    helpers: helpers.slice(0, HELPER_COUNT),
    helperOverflow: Math.max(0, helpers.length - HELPER_COUNT),
    generatedAt: now,
  };
}
