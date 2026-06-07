import { type ClassValue } from 'clsx';
/**
 * Merges Tailwind CSS classes with proper conflict resolution.
 * Combines clsx for conditional classes with tailwind-merge for deduplication.
 */
export declare function cn(...inputs: ClassValue[]): string;
/**
 * Formats a date string or Date object to DD/MM/YYYY HH:mm format.
 */
export declare function formatDate(date: string | Date): string;
/**
 * Truncates text to a maximum length, appending ellipsis if truncated.
 */
export declare function truncateText(text: string, maxLength: number): string;
/**
 * Formats a lead score as a display string with percentage.
 */
export declare function formatScore(score: number | null | undefined): string;
/**
 * Maps temperature values to display labels.
 */
export declare function formatTemperature(temperature: string | null | undefined): string;
/**
 * Maps lead status values to display labels.
 */
export declare function formatStatus(status: string | null | undefined): string;
/**
 * Returns a placeholder string for null/empty values.
 */
export declare function displayOrPlaceholder(value: string | null | undefined, placeholder?: string): string;
