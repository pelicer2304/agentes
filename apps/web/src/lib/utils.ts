import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS classes with proper conflict resolution.
 * Combines clsx for conditional classes with tailwind-merge for deduplication.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date string or Date object to DD/MM/YYYY HH:mm format.
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Truncates text to a maximum length, appending ellipsis if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Formats a lead score as a display string with percentage.
 */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—';
  return `${score}/100`;
}

/**
 * Maps temperature values to display labels.
 */
export function formatTemperature(temperature: string | null | undefined): string {
  if (!temperature) return '—';
  const map: Record<string, string> = {
    frio: 'Frio',
    morno: 'Morno',
    quente: 'Quente',
  };
  return map[temperature] ?? temperature;
}

/**
 * Maps lead status values to display labels.
 */
export function formatStatus(status: string | null | undefined): string {
  if (!status) return '—';
  const map: Record<string, string> = {
    novo: 'Novo',
    qualificando: 'Qualificando',
    frio: 'Frio',
    morno: 'Morno',
    quente: 'Quente',
    chamar_humano: 'Chamar Humano',
    convertido: 'Convertido',
    perdido: 'Perdido',
  };
  return map[status] ?? status;
}

/**
 * Returns a placeholder string for null/empty values.
 */
export function displayOrPlaceholder(
  value: string | null | undefined,
  placeholder = 'Não informado'
): string {
  if (!value || value.trim() === '') return placeholder;
  return value;
}
