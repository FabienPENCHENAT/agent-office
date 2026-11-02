export type ChristmasDecor = 'auto' | 'on' | 'off';

/**
 * Décor de Noël du bureau : `auto` l'affiche du 1er décembre au 6 janvier inclus (date locale),
 * `on` et `off` le forcent toute l'année.
 */
export function christmasDecor(setting: ChristmasDecor, date: Date): boolean {
  if (setting === 'on' || setting === 'off') {
    return setting === 'on';
  }
  return date.getMonth() === 11 || (date.getMonth() === 0 && date.getDate() <= 6);
}
