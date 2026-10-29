import { AgentStatus, SLOT_COUNT, Slot } from '../types';

/**
 * Règle stable de placement :
 *  1. les agents listés dans `agentOffice.pinnedAgents`, dans cet ordre ;
 *  2. puis les autres, triés par nom (ordre alphabétique, insensible à la casse),
 *     puis par runtime (claude-code avant copilot) en cas d'égalité.
 * Les dix premiers occupent les emplacements 1 à 10 ; les suivants sont listés en débordement.
 * L'état d'activité n'influence jamais le placement, pour que chaque agent garde son bureau.
 */
export function orderAgents(agents: AgentStatus[], pinned: string[]): AgentStatus[] {
  const rank = (a: AgentStatus): number => {
    const i = pinned.indexOf(a.name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...agents].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) ||
      a.runtime.localeCompare(b.runtime),
  );
}

export function assignSlots(agents: AgentStatus[], pinned: string[] = []): { slots: Slot[]; overflow: AgentStatus[] } {
  const ordered = orderAgents(agents, pinned);
  const slots: Slot[] = Array.from({ length: SLOT_COUNT }, (_, index) => ({ index, agent: ordered[index] }));
  return { slots, overflow: ordered.slice(SLOT_COUNT) };
}
