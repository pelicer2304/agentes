import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardContent } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Card title="My Card">Content</Card>);
    expect(screen.getByText('My Card')).toBeInTheDocument();
  });

  it('does not render title element when title is not provided', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.querySelector('h3')).not.toBeInTheDocument();
  });

  it('applies dark theme card styles', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('border-border');
    expect(card.className).toContain('rounded-card');
  });

  it('merges custom className', () => {
    const { container } = render(<Card className="my-class">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('my-class');
  });
});

describe('CardHeader', () => {
  it('renders children', () => {
    render(<CardHeader>Header</CardHeader>);
    expect(screen.getByText('Header')).toBeInTheDocument();
  });
});

describe('CardContent', () => {
  it('renders children', () => {
    render(<CardContent>Body</CardContent>);
    expect(screen.getByText('Body')).toBeInTheDocument();
  });
});
