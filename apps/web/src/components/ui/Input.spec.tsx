import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input, Textarea } from './Input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('applies dark theme styles', () => {
    render(<Input placeholder="test" />);
    const input = screen.getByPlaceholderText('test');
    expect(input.className).toContain('bg-card');
    expect(input.className).toContain('text-foreground');
  });

  it('shows error message and error border when error prop is set', () => {
    render(<Input error="Required field" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('border-red-500');
  });

  it('does not show error border when no error', () => {
    render(<Input placeholder="ok" />);
    const input = screen.getByPlaceholderText('ok');
    expect(input.className).toContain('border-border');
    expect(input.className).not.toContain('border-red-500');
  });

  it('accepts user input', async () => {
    const user = userEvent.setup();
    render(<Input placeholder="type here" />);
    const input = screen.getByPlaceholderText('type here');
    await user.type(input, 'hello');
    expect(input).toHaveValue('hello');
  });

  it('is disabled when disabled prop is set', () => {
    render(<Input disabled placeholder="disabled" />);
    expect(screen.getByPlaceholderText('disabled')).toBeDisabled();
  });

  it('merges custom className', () => {
    render(<Input className="w-64" placeholder="custom" />);
    const input = screen.getByPlaceholderText('custom');
    expect(input.className).toContain('w-64');
  });
});

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea placeholder="Enter long text" />);
    expect(screen.getByPlaceholderText('Enter long text')).toBeInTheDocument();
  });

  it('shows error message when error prop is set', () => {
    render(<Textarea error="Too short" />);
    expect(screen.getByText('Too short')).toBeInTheDocument();
  });

  it('applies dark theme styles', () => {
    render(<Textarea placeholder="area" />);
    const textarea = screen.getByPlaceholderText('area');
    expect(textarea.className).toContain('bg-card');
    expect(textarea.className).toContain('text-foreground');
  });
});
