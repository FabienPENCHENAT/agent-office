import { AgentDefinition, Interaction, OfficeSnapshot, RuntimeReport } from '../types';
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
    generatedAt: now,
  };
}
