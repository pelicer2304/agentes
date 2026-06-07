import type { AgentSettings } from '@/types';
export interface AgentSettingsFormProps {
    settings: AgentSettings | undefined;
    isLoading: boolean;
    isSaving: boolean;
    saveError: string | null;
    saveSuccess: boolean;
    onSave: (data: Omit<AgentSettings, 'id' | 'createdAt' | 'updatedAt'>) => void;
    onResetSaveState: () => void;
}
export declare function AgentSettingsForm({ settings, isLoading, isSaving, saveError, saveSuccess, onSave, onResetSaveState, }: AgentSettingsFormProps): import("react/jsx-runtime").JSX.Element;
