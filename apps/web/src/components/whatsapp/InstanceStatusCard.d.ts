import type { InstanceStatus } from '@/types';
interface InstanceStatusCardProps {
    status: InstanceStatus | null;
    statusError: string | null;
    lastEvent: string | null;
    lastError: string | null;
}
/**
 * Displays the instance status, name, connected number, last event, and last
 * Evolution error (Req 15.2, 15.6).
 */
export declare function InstanceStatusCard({ status, statusError, lastEvent, lastError, }: InstanceStatusCardProps): import("react/jsx-runtime").JSX.Element;
export {};
