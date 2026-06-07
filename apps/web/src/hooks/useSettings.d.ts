import type { AgentSettings } from '@/types';
export interface UseSettingsReturn {
    settings: AgentSettings | undefined;
    isLoading: boolean;
    save: (settings: Omit<AgentSettings, 'id' | 'createdAt' | 'updatedAt'>) => void;
    isSaving: boolean;
    error: string | null;
    saveError: string | null;
    saveSuccess: boolean;
    resetSaveState: () => void;
}
export declare function useSettings(): UseSettingsReturn;
