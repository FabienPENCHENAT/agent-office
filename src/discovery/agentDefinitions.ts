import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentDefinition, RuntimeId } from '../types';

export interface DefinitionSource {
  runtime: RuntimeId;
  scope: 'user' | 'project';
  dir: string;
}

export interface DiscoveryResult {
  definitions: AgentDefinition[];
  /** Dossiers présents mais illisibles (erreurs d'accès). */
  errors: { dir: string; message: string }[];
}

/**
 * Emplacements connus des définitions d'agents.
 * Claude Code : ~/.claude/agents (utilisateur) et <workspace>/.claude/agents (projet).
 * Copilot : ~/.copilot/agents (utilisateur) et <workspace>/.github/agents (projet).
 */
export function definitionSources(claudeDir: string, homeDir: string, workspaceDirs: string[]): DefinitionSource[] {
  const sources: DefinitionSource[] = [
    { runtime: 'claude-code', scope: 'user', dir: path.join(claudeDir, 'agents') },
    { runtime: 'copilot', scope: 'user', dir: path.join(homeDir, '.copilot', 'agents') },
  ];
  for (const ws of workspaceDirs) {
    sources.push({ runtime: 'claude-code', scope: 'project', dir: path.join(ws, '.claude', 'agents') });
    sources.push({ runtime: 'copilot', scope: 'project', dir: path.join(ws, '.github', 'agents') });
  }
  return sources;
}

type Frontmatter = { name?: string; color?: string; description?: string };

/**
 * Extrait les champs simples `name`, `color` et `description` d'un frontmatter YAML, sans rien interpréter d'autre.
 * `description` accepte aussi un bloc multiligne (`|` ou `>`), dont les lignes indentées sont jointes.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) {
    return {};
  }
  const out: Frontmatter = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(name|color|description):\s*(.*?)\s*$/.exec(lines[i]);
    if (!kv) {
      continue;
    }
    let value = kv[2];
    if (kv[1] === 'description' && /^[|>][-+]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) {
        block.push(lines[++i].trim());
      }
      value = block.filter(Boolean).join(' ');
    }
    value = value.replace(/^(['"])(.*)\1$/, '$2').trim();
    if (value) {
      out[kv[1] as keyof Frontmatter] = value;
    }
  }
  return out;
}

function fallbackName(file: string): string {
  return path.basename(file).replace(/\.agent\.md$/i, '').replace(/\.md$/i, '');
}

async function listMarkdown(dir: string, depth = 0): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(full);
    } else if (entry.isDirectory() && depth < 2 && !entry.name.startsWith('.')) {
      files.push(...(await listMarkdown(full, depth + 1)));
    }
  }
  return files;
}

/** Lecture seule : ne fait qu'énumérer et lire les fichiers .md des emplacements donnés. */
export async function discoverDefinitions(sources: DefinitionSource[]): Promise<DiscoveryResult> {
  const byId = new Map<string, AgentDefinition>();
  const errors: DiscoveryResult['errors'] = [];

  for (const source of sources) {
    let files: string[];
    try {
      files = await listMarkdown(source.dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        errors.push({ dir: source.dir, message: code ?? String(err) });
      }
      continue;
    }
    for (const file of files.sort()) {
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch (err) {
        errors.push({ dir: file, message: (err as NodeJS.ErrnoException).code ?? String(err) });
        continue;
      }
      const fm = parseFrontmatter(text);
      const name = fm.name ?? fallbackName(file);
      const id = `${source.runtime}:${name}`;
      const existing = byId.get(id);
      // Une définition de projet remplace une définition utilisateur du même nom.
      if (existing && existing.scope === 'project' && source.scope === 'user') {
        continue;
      }
      byId.set(id, { id, name, runtime: source.runtime, scope: source.scope, color: fm.color, description: fm.description });
    }
  }
  return { definitions: [...byId.values()], errors };
}
