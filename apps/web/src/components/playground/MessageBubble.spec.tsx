import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageBubble } from './MessageBubble';

describe('MessageBubble', () => {
  it('renders message content', () => {
    render(
      <MessageBubble
        content="Hello, how can I help?"
        role="assistant"
        createdAt="2024-01-15T10:30:00Z"
      />
    );

    expect(screen.getByText('Hello, how can I help?')).toBeInTheDocument();
  });

  it('renders timestamp', () => {
    render(
      <MessageBubble
        content="Test message"
        role="user"
        createdAt="2024-01-15T14:25:00Z"
      />
    );

    // Time will be formatted in local timezone, so we check it exists
    const timeElement = screen.getByText(/\d{2}:\d{2}/);
    expect(timeElement).toBeInTheDocument();
  });

  it('aligns user messages to the right', () => {
    const { container } = render(
      <MessageBubble
        content="User message"
        role="user"
        createdAt="2024-01-15T10:30:00Z"
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-end');
  });

  it('aligns assistant messages to the left', () => {
    const { container } = render(
      <MessageBubble
        content="Assistant message"
        role="assistant"
        createdAt="2024-01-15T10:30:00Z"
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-start');
  });

  it('applies accent-dark background for user messages', () => {
    const { container } = render(
      <MessageBubble
        content="User message"
        role="user"
        createdAt="2024-01-15T10:30:00Z"
      />
    );

    const bubble = container.querySelector('.bg-accent-dark');
    expect(bubble).toBeInTheDocument();
  });

  it('applies card background for assistant messages', () => {
    const { container } = render(
      <MessageBubble
        content="Assistant message"
        role="assistant"
        createdAt="2024-01-15T10:30:00Z"
      />
    );

    const bubble = container.querySelector('.bg-card');
    expect(bubble).toBeInTheDocument();
  });

  it('handles invalid date gracefully', () => {
    render(
      <MessageBubble
        content="Test message"
        role="user"
        createdAt="invalid-date"
      />
    );

    expect(screen.getByText('Test message')).toBeInTheDocument();
  });
});
