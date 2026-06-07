import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ChatPanel } from './ChatPanel';
import type { Message } from '@/types';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const mockMessages: Message[] = [
  {
    id: '1',
    conversationId: 'conv-1',
    role: 'assistant',
    direction: 'outbound',
    content:
      'Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.',
    metadata: null,
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    id: '2',
    conversationId: 'conv-1',
    role: 'user',
    direction: 'inbound',
    content: 'Tenho uma clínica odontológica e uso WhatsApp para agendar consultas.',
    metadata: null,
    createdAt: '2024-01-15T10:01:00Z',
  },
  {
    id: '3',
    conversationId: 'conv-1',
    role: 'assistant',
    direction: 'outbound',
    content: 'Entendi. Quantos agendamentos vocês fazem por dia pelo WhatsApp?',
    metadata: null,
    createdAt: '2024-01-15T10:01:30Z',
  },
];

describe('ChatPanel', () => {
  it('renders all messages', () => {
    render(<ChatPanel messages={mockMessages} />);

    expect(
      screen.getByText(/Sou o Assistente Decodifica/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Tenho uma clínica odontológica/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Quantos agendamentos vocês fazem/)
    ).toBeInTheDocument();
  });

  it('renders empty state when no messages', () => {
    const { container } = render(<ChatPanel messages={[]} />);

    // Should render the container but no message bubbles
    const bubbles = container.querySelectorAll('.bg-card, .bg-accent-dark');
    expect(bubbles.length).toBe(0);
  });

  it('shows loading indicator when isLoading is true', () => {
    render(<ChatPanel messages={mockMessages} isLoading={true} />);

    expect(screen.getByText('Digitando...')).toBeInTheDocument();
  });

  it('does not show loading indicator when isLoading is false', () => {
    render(<ChatPanel messages={mockMessages} isLoading={false} />);

    expect(screen.queryByText('Digitando...')).not.toBeInTheDocument();
  });

  it('auto-scrolls to bottom when messages change', () => {
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const { rerender } = render(<ChatPanel messages={mockMessages} />);

    const newMessages: Message[] = [
      ...mockMessages,
      {
        id: '4',
        conversationId: 'conv-1',
        role: 'user',
        direction: 'inbound',
        content: 'Cerca de 30 por dia.',
        metadata: null,
    createdAt: '2024-01-15T10:02:00Z',
      },
    ];

    rerender(<ChatPanel messages={newMessages} />);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('displays initial greeting message', () => {
    const greetingMessages: Message[] = [
      {
        id: '1',
        conversationId: 'conv-1',
        role: 'assistant',
        direction: 'outbound',
        content:
          'Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.',
        metadata: null,
    createdAt: '2024-01-15T10:00:00Z',
      },
    ];

    render(<ChatPanel messages={greetingMessages} />);

    expect(
      screen.getByText(/Sou o Assistente Decodifica/)
    ).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ChatPanel messages={[]} className="custom-class" />
    );

    const panel = container.firstChild as HTMLElement;
    expect(panel.className).toContain('custom-class');
  });
});
