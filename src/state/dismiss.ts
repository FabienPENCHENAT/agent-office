import { RuntimeReport } from '../types';

/**
 * Retire du relevé les instances de sous-agents que l'utilisateur a retirées du bureau : leurs signaux
 * et leurs mini-bots disparaissent. Claude Code n'est pas touché ; seul l'affichage change.
 */
export function withoutDismissed(report: RuntimeReport, dismissed: ReadonlySet<string>): RuntimeReport {
  if (!dismissed.size) {
    return report;
  }
  return {
    ...report,
    signals: report.signals.filter((s) => !s.runId || !dismissed.has(s.runId)),
    ...(report.subagents ? { subagents: report.subagents.filter((r) => !dismissed.has(r.id)) } : {}),
  };
}
