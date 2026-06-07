interface ManualMessageInputProps {
    onSend: (content: string) => Promise<unknown>;
    isSending: boolean;
    error: string | null;
    disabled?: boolean;
}
/**
 * Manual message field for the conversation detail (Req 16.4, 13.1). Sends the
 * message via the parent handler and clears the field on success.
 */
export declare function ManualMessageInput({ onSend, isSending, error, disabled, }: ManualMessageInputProps): import("react/jsx-runtime").JSX.Element;
export {};
