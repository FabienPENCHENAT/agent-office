import { OfficeSnapshot } from '../types';

export type SummaryKind = 'active' | 'idle' | 'unknown' | 'empty';

export interface Summary {
  kind: SummaryKind;
  /** Noms des agents actifs (y compris hors des dix emplacements). */
  activeNames: string[];
  unknownCount: number;
  text: string;
}

/** Réponse à « Quel agent travaille en ce moment ? ». */
export function summarize(snapshot: OfficeSnapshot): Summary {
  const all = [...snapshot.slots.flatMap((s) => (s.agent ? [s.agent] : [])), ...snapshot.overflow];
  const activeNames = all.filter((a) => a.state === 'active').map((a) => a.name);
  const unknownCount = all.filter((a) => a.state === 'unknown').length;

  if (all.length === 0) {
    const sourceDown = snapshot.health.some((h) => h.status !== 'ok');
    return {
      kind: sourceDown ? 'unknown' : 'empty',
      activeNames,
      unknownCount,
      text: sourceDown ? 'Unknown status — no agent source available' : 'No agents found',
    };
  }
  if (activeNames.length === 1) {
    return { kind: 'active', activeNames, unknownCount, text: `Active agent: ${activeNames[0]}` };
  }
  if (activeNames.length > 1) {
    return {
      kind: 'active',
      activeNames,
      unknownCount,
      text: `${activeNames.length} active agents: ${activeNames.join(', ')}`,
    };
  }
  if (unknownCount > 0) {
    return {
      kind: 'unknown',
      activeNames,
      unknownCount,
      text:
        unknownCount === all.length
          ? 'Unknown status — activity cannot be detected'
          : `Unknown status for ${unknownCount} agent${unknownCount > 1 ? 's' : ''} — cannot confirm they are idle`,
    };
  }
  return { kind: 'idle', activeNames, unknownCount, text: 'No active agents' };
}
