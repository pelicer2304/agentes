import type { BotSettings, UpdateBotSettingsInput } from '@/types';
export interface UseBotSettingsResult {
    settings: BotSettings | undefined;
    isLoading: boolean;
    error: string | null;
    save: (input: UpdateBotSettingsInput) => void;
    isSaving: boolean;
    saveError: string | null;
    saveSuccess: boolean;
    resetSaveState: () => void;
}
/**
 * Loads and persists Bot settings (Req 17.1, 17.5). Auto-reply is read-only
 * (env-based); only Pricing_Config fields are editable via PUT /bot/settings.
 */
export declare function useBotSettings(): UseBotSettingsResult;
