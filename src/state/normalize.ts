import { AgentDefinition, AgentState, AgentStatus, RuntimeReport } from '../types';

/**
 * Combine définitions et signaux en un état par agent.
 * - actif si au moins une instance vivante est active ;
 * - sinon inconnu si une instance est non concluante ou si la source du runtime n'est pas fiable ;
 * - sinon inactif (source lisible et aucune instance active).
 * Les signaux d'agents non définis (agents intégrés, autres types) sont ignorés.
 */
export function normalize(definitions: AgentDefinition[], reports: RuntimeReport[]): AgentStatus[] {
  return definitions.map((def) => {
    const report = reports.find((r) => r.health.runtime === def.runtime);
    const signals = report?.signals.filter((s) => s.agentName === def.name) ?? [];
    let state: AgentState;
    if (signals.some((s) => s.state === 'active')) {
      state = 'active';
    } else if (!report || report.health.status !== 'ok' || signals.some((s) => s.state === 'unknown')) {
      state = 'unknown';
    } else {
      state = 'inactive';
    }
    const relevant = signals.filter((s) => (state === 'active' ? s.state === 'active' : true));
    const updatedAt = relevant.length ? Math.max(...relevant.map((s) => s.observedAt)) : undefined;
    return { id: def.id, name: def.name, runtime: def.runtime, color: def.color, state, updatedAt };
  });
}
