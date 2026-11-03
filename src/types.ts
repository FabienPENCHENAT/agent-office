/** Runtime qui héberge une définition d'agent. */
export type RuntimeId = 'claude-code' | 'copilot';

/** Une définition d'agent trouvée sur disque (seul le nom est conservé). */
export interface AgentDefinition {
  /** Identifiant normalisé : runtime + nom, ex. "claude-code:tech-lead". */
  id: string;
  name: string;
  runtime: RuntimeId;
  scope: 'user' | 'project';
  /** Couleur déclarée dans le frontmatter (`color:`), si présente. */
  color?: string;
  /**
   * Description du frontmatter (`description:`), utilisée seulement pour deviner la pièce d'un agent
   * dont le nom ne dit rien. Elle reste côté extension : elle n'est jamais envoyée à la vue.
   */
  description?: string;
  /** Chemin du fichier .md de la définition, pour l'ouvrir dans l'éditeur. Il n'est jamais envoyé à la vue. */
  file?: string;
  /** Personnage « Claude » des sessions lancées sans agent : il n'a pas de fichier de définition. */
  builtin?: boolean;
}

/** Signal brut émis par un adaptateur de runtime pour une instance d'agent. */
export interface ActivitySignal {
  runtime: RuntimeId;
  agentName: string;
  /** active : travaille ; idle : vivant mais en attente ; unknown : signal présent mais non concluant. */
  state: 'active' | 'idle' | 'unknown';
  /** Horodatage (ms) de la dernière mise à jour observée de ce signal. */
  observedAt: number;
  /** Modèle utilisé, sous forme lisible (ex. « Opus 5.5 »), quand il est connu. */
  model?: string;
  /** Instance de sous-agent qui émet ce signal (même identifiant que `SubagentRun.id`). */
  runId?: string;
}

/** Disponibilité de la source de signaux d'un runtime. */
export interface RuntimeHealth {
  runtime: RuntimeId;
  /** ok : source lisible ; unavailable : erreur d'accès ; unsupported : aucun signal d'activité connu. */
  status: 'ok' | 'unavailable' | 'unsupported';
  message?: string;
}

/**
 * Délégation réelle observée : un agent principal de session a lancé un sous-agent.
 * Seuls les noms et les horodatages sont conservés (jamais la consigne elle-même).
 */
export interface Delegation {
  id: string;
  from: string;
  to: string;
  runtime: RuntimeId;
  startedAt: number;
  /** Présent quand le sous-agent est marqué terminé. */
  finishedAt?: number;
}

/** Sous-agent en cours d'exécution (une instance), quel que soit son type. */
export interface SubagentRun {
  /** Identifiant stable de l'instance : session + fichier du sous-agent. */
  id: string;
  agentType: string;
  state: 'active' | 'unknown';
  startedAt: number;
}

export interface RuntimeReport {
  health: RuntimeHealth;
  signals: ActivitySignal[];
  delegations?: Delegation[];
  /** Sous-agents non terminés, un par instance. */
  subagents?: SubagentRun[];
}

export type AgentState = 'active' | 'inactive' | 'unknown';

export interface AgentStatus {
  id: string;
  name: string;
  runtime: RuntimeId;
  color?: string;
  state: AgentState;
  /** Dernière mise à jour connue de l'état (ms), ou undefined. */
  updatedAt?: number;
  /** Modèle de l'instance la plus récente, sous forme lisible, quand il est connu. */
  model?: string;
  /** Personnage « Claude » intégré, sans fichier de définition. */
  builtin?: boolean;
  /** État inconnu dû seulement à des sous-agents silencieux : leurs instances, que l'utilisateur peut retirer du bureau. */
  stuckRuns?: string[];
}

/** Postes de travail du bureau : trois bureaux individuels et l'open space engineering. */
export type Workstation =
  | 'office-pm'
  | 'office-challenger'
  | 'office-design'
  | 'open-1'
  | 'open-2'
  | 'open-3'
  | 'open-4'
  | 'open-5'
  | 'open-6'
  | 'open-7';

export const OFFICES: Workstation[] = ['office-pm', 'office-challenger', 'office-design'];
export const OPEN_DESKS: Workstation[] = ['open-1', 'open-2', 'open-3', 'open-4', 'open-5', 'open-6', 'open-7'];

/** Rôle d'un agent, qui détermine sa pièce. */
export type AgentRole = 'pm' | 'challenger' | 'design' | 'engineering';

export interface Slot {
  index: number;
  agent?: AgentStatus;
  workstation?: Workstation;
}

/** Interaction transmise à la vue : qui a délégué à qui, et quand. */
export interface Interaction {
  id: string;
  from: string;
  to: string;
  startedAt: number;
  finishedAt?: number;
}

/**
 * Sous-agent sans personnage attitré (agent intégré, ou instance en plus d'un agent déjà au travail) :
 * représenté par un mini-bot qui entre par la porte du couloir et s'installe où il y a de la place.
 */
export interface Helper {
  id: string;
  /** Type du sous-agent (ex. « Explore »). */
  name: string;
  state: 'active' | 'unknown';
  startedAt: number;
}

/** Instantané envoyé à la vue : rien d'autre que nom, état et heure. */
export interface OfficeSnapshot {
  slots: Slot[];
  /** Agents découverts mais non représentés (au-delà de dix). */
  overflow: AgentStatus[];
  discoveredCount: number;
  health: RuntimeHealth[];
  /** Avertissements de découverte (dossiers illisibles, etc.). */
  notices: string[];
  /** Délégations récentes ou en cours entre agents représentés. */
  interactions: Interaction[];
  /** Mini-bots des sous-agents en cours, les plus anciens d'abord. */
  helpers: Helper[];
  /** Sous-agents en cours au-delà des mini-bots représentés. */
  helperOverflow: number;
  generatedAt: number;
}

export const SLOT_COUNT = 10;
/** Nombre maximal de mini-bots dans le bureau. */
export const HELPER_COUNT = 8;
