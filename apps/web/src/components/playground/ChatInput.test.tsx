import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ChatInput } from './ChatInput';

describe('ChatInput', () => {
  it('renders textarea and send button', () => {
    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByLabelText('Mensagem')).toBeInTheDocument();
    expect(screen.getByLabelText('Enviar mensagem')).toBeInTheDocument();
  });

  it('calls onSend with trimmed message on button click', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, 'Olá, preciso de ajuda');
    await user.click(screen.getByLabelText('Enviar mensagem'));

    expect(onSend).toHaveBeenCalledWith('Olá, preciso de ajuda');
  });

  it('calls onSend on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, 'Mensagem de teste');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSend).toHaveBeenCalledWith('Mensagem de teste');
  });

  it('calls onSend on Meta+Enter (Cmd+Enter)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, 'Mensagem Mac');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSend).toHaveBeenCalledWith('Mensagem Mac');
  });

  it('does not send on plain Enter (allows new line)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, 'Linha 1');
    await user.keyboard('{Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows error for empty message submission', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, '   ');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(screen.getByText('Digite uma mensagem')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows error for message exceeding 4000 characters', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
    const longMessage = 'a'.repeat(4001);

    // Set value directly for performance
    fireEvent.change(textarea, { target: { value: longMessage } });

    // Try to send via Ctrl+Enter
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(screen.getByText('Mensagem deve ter no máximo 4000 caracteres')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears input after successful send', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
    await user.type(textarea, 'Mensagem');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(textarea.value).toBe('');
  });

  it('disables textarea and button when disabled prop is true', () => {
    render(<ChatInput onSend={vi.fn()} disabled={true} />);

    expect(screen.getByLabelText('Mensagem')).toBeDisabled();
    expect(screen.getByLabelText('Enviar mensagem')).toBeDisabled();
  });

  it('does not send when disabled', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const { rerender } = render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, 'Test message');

    // Re-render with disabled
    rerender(<ChatInput onSend={onSend} disabled={true} />);

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows character count', () => {
    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByText('0/4000')).toBeInTheDocument();
  });

  it('updates character count as user types', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, 'Hello');

    expect(screen.getByText('5/4000')).toBeInTheDocument();
  });

  it('shows character count in red when exceeding limit', () => {
    render(<ChatInput onSend={vi.fn()} />);

    const textarea = screen.getByLabelText('Mensagem');
    const longMessage = 'a'.repeat(4001);

    fireEvent.change(textarea, { target: { value: longMessage } });

    const countEl = screen.getByText('4001/4000');
    expect(countEl).toHaveClass('text-red-400');
  });

  it('clears error when user starts typing again', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} />);

    const textarea = screen.getByLabelText('Mensagem');
    await user.type(textarea, '   ');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(screen.getByText('Digite uma mensagem')).toBeInTheDocument();

    await user.type(textarea, 'a');

    expect(screen.queryByText('Digite uma mensagem')).not.toBeInTheDocument();
  });

  it('send button is disabled when textarea is empty', () => {
    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByLabelText('Enviar mensagem')).toBeDisabled();
  });

  it('applies custom className', () => {
    const { container } = render(<ChatInput onSend={vi.fn()} className="mt-4" />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('mt-4');
  });
});
