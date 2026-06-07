export interface ChatInputProps {
    onSend: (content: string) => void;
    disabled?: boolean;
    className?: string;
}
export declare function ChatInput({ onSend, disabled, className }: ChatInputProps): import("react/jsx-runtime").JSX.Element;
