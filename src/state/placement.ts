import { AgentRole, AgentStatus, OFFICES, OPEN_DESKS, Workstation } from '../types';

const ROLE_OFFICE: Record<Exclude<AgentRole, 'engineering'>, Workstation> = {
  pm: 'office-pm',
  challenger: 'office-challenger',
  design: 'office-design',
};

/** Nom qui désigne clairement un profil technique : sa description n'est pas consultée. */
const ENGINEERING_NAME = /dev|engineer|qa|test|tech|lead|architect|backend|frontend|fullstack|ops|admin|doc|secur|data|code|review/;

/** Mots-clés cherchés dans la description d'un agent au nom non reconnu (anglais et français). */
const DESCRIPTION_RULES: [AgentRole, RegExp][] = [
  ['pm', /product[-_ ]?(manager|owner)|project manager|chef de (produit|projet)|orchestrat|coordinat/],
  ['challenger', /challeng|devil'?s advocate|avocat du diable|brainstorm/],
  ['design', /\bux\b|\bui\b|user experience|user interface|designer|wireframe|mockup|maquette|figma/],
];

/**
 * Rôle d'un agent, qui détermine sa pièce :
 *  1. le réglage `agentOffice.agentRooms` ;
 *  2. le nom de l'agent ;
 *  3. pour un nom qui ne dit rien (ni rôle connu, ni profil technique), sa description : le mot-clé
 *     qui apparaît le plus tôt l'emporte.
 * Tout ce qui n'est ni PM, ni challenger, ni design rejoint l'équipe engineering (open space).
 */
export function roleOf(name: string, overrides: Record<string, string> = {}, description = ''): AgentRole {
  const forced = overrides[name];
  if (forced === 'pm' || forced === 'challenger' || forced === 'design' || forced === 'engineering') {
    return forced;
  }
  const n = name.toLowerCase();
  if (/product[-_ ]?manager|^pm$|^po$|product[-_ ]?owner/.test(n)) {
    return 'pm';
  }
  if (/challenger/.test(n)) {
    return 'challenger';
  }
  if (/(^|[-_ ])(ux|ui)([-_ ]|$)|design/.test(n)) {
    return 'design';
  }
  if (ENGINEERING_NAME.test(n)) {
    return 'engineering';
  }
  const d = description.toLowerCase();
  let best: { role: AgentRole; at: number } | undefined;
  for (const [role, re] of DESCRIPTION_RULES) {
    const m = re.exec(d);
    if (m && (!best || m.index < best.at)) {
      best = { role, at: m.index };
    }
  }
  return best?.role ?? 'engineering';
}

/**
 * Attribue un poste à chaque agent représenté (dans l'ordre stable des emplacements) :
 *  1. PM, challenger et designer prennent leur bureau individuel s'il est libre ;
 *  2. les autres occupent l'open space (7 postes) ;
 *  3. s'il n'y a plus de place dans l'open space, les bureaux individuels libres servent d'appoint.
 */
export function placeAgents(
  agents: AgentStatus[],
  overrides: Record<string, string> = {},
  descriptions: Map<string, string> = new Map(),
): Map<string, Workstation> {
  const result = new Map<string, Workstation>();
  const taken = new Set<Workstation>();
  const pending: AgentStatus[] = [];

  for (const agent of agents) {
    const role = roleOf(agent.name, overrides, descriptions.get(agent.id));
    const office = role === 'engineering' ? undefined : ROLE_OFFICE[role];
    if (office && !taken.has(office)) {
      taken.add(office);
      result.set(agent.id, office);
    } else {
      pending.push(agent);
    }
  }
  const free = [...OPEN_DESKS, ...OFFICES].filter((w) => !taken.has(w));
  for (const agent of pending) {
    const ws = free.shift();
    if (ws) {
      result.set(agent.id, ws);
    }
  }
  return result;
}
