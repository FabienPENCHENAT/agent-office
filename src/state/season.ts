/**
 * Décor de saison du bureau. Seul l'hiver existe pour l'instant : du 1er décembre au 6 janvier inclus (date locale).
 * Désactivé, aucun décor n'apparaît.
 */
export function winterDecor(enabled: boolean, date: Date): boolean {
  return enabled && (date.getMonth() === 11 || (date.getMonth() === 0 && date.getDate() <= 6));
}
