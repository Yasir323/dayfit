/**
 * What the tray shows for the latest unseen reminder. Only macOS can put text next to a tray
 * icon (`title`); elsewhere `title` is null and the tooltip carries the label.
 */
export function trayDisplay(
  label: string | null,
  platform: NodeJS.Platform
): { title: string | null; tooltip: string } {
  const tooltip = label === null ? 'Dayfit' : `Dayfit — ${label}`
  if (platform !== 'darwin') return { title: null, tooltip }
  return { title: label === null ? '' : ` ${label}`, tooltip }
}
