import { AgentDefinition, AgentState, AgentStatus, RuntimeReport } from '../types';

/**
 * Combine définitions et signaux en un état par agent.
 * - en attente si une instance attend une réponse de l'utilisateur (c'est ce qu'il doit savoir en premier) ;
 * - sinon actif si au moins une instance vivante est active ;
 * - sinon inconnu si une instance est non concluante ou si la source du runtime n'est pas fiable ;
 * - sinon inactif (source lisible et aucune instance active).
 * Les signaux d'agents non définis (agents intégrés, autres types) sont ignorés.
 */
export function normalize(definitions: AgentDefinition[], reports: RuntimeReport[]): AgentStatus[] {
  return definitions.map((def) => {
    const report = reports.find((r) => r.health.runtime === def.runtime);
    const signals = report?.signals.filter((s) => s.agentName === def.name) ?? [];
    let state: AgentState;
    if (signals.some((s) => s.state === 'waiting')) {
      state = 'waiting';
    } else if (signals.some((s) => s.state === 'active')) {
      state = 'active';
    } else if (!report || report.health.status !== 'ok' || signals.some((s) => s.state === 'unknown')) {
      state = 'unknown';
    } else {
      state = 'inactive';
    }
    const relevant = signals.filter((s) => (state === 'active' || state === 'waiting' ? s.state === state : true));
    const recent = [...relevant].sort((a, b) => b.observedAt - a.observedAt);
    const model = recent.find((s) => s.model)?.model;
    // Inconnu seulement à cause de sous-agents perdus : ces instances peuvent être retirées du bureau.
    const unknown = signals.filter((s) => s.state === 'unknown');
    const stuckRuns =
      state === 'unknown' && report?.health.status === 'ok' && unknown.every((s) => s.runId && s.stuck)
        ? unknown.map((s) => s.runId as string)
        : [];
    return {
      id: def.id,
      name: def.name,
      runtime: def.runtime,
      color: def.color,
      state,
      updatedAt: recent[0]?.observedAt,
      ...(model ? { model } : {}),
      ...(def.builtin ? { builtin: true } : {}),
      ...(stuckRuns.length ? { stuckRuns } : {}),
    };
  });
}
