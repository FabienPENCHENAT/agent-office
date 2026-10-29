import { RuntimeReport } from '../types';

/**
 * GitHub Copilot : les définitions d'agents (~/.copilot/agents, .github/agents) sont découvertes,
 * mais aucune interface locale documentée n'expose l'activité en cours d'un agent.
 * L'état de ces agents reste donc « inconnu » plutôt que d'être deviné.
 */
export function readCopilot(): RuntimeReport {
  return {
    health: {
      runtime: 'copilot',
      status: 'unsupported',
      message: 'Copilot exposes no local activity signal: status unknown.',
    },
    signals: [],
  };
}
