import type { QualificationData } from '@/types';
export interface QualificationPanelProps {
    qualification: QualificationData | null;
}
/**
 * QualificationPanel displays real-time lead qualification data
 * in a scrollable right column of the Playground page.
 *
 * - When qualification is null (no messages yet), shows placeholder text.
 * - Retains previous values when new response has null fields (handled by parent via state merging).
 * - Shows a prominent handoff badge when shouldHandoff is true.
 * - Updates immediately when API response arrives (no page reload).
 */
export declare function QualificationPanel({ qualification }: QualificationPanelProps): import("react/jsx-runtime").JSX.Element;
