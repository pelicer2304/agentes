import type { BotSettings, UpdateBotSettingsInput } from '@/types';
interface PricingConfigFormProps {
    settings: BotSettings;
    onSave: (input: UpdateBotSettingsInput) => void;
    isSaving: boolean;
    saveError: string | null;
    saveSuccess: boolean;
}
/**
 * Edit form for Pricing_Config (Req 17.1, 17.5): pricingRangeEnabled,
 * pricingStartingAt, and pricingText.
 */
export declare function PricingConfigForm({ settings, onSave, isSaving, saveError, saveSuccess, }: PricingConfigFormProps): import("react/jsx-runtime").JSX.Element;
export {};
