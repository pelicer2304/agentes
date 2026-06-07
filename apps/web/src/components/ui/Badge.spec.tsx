import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders text content', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies default variant styles', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge.className).toContain('bg-card');
  });

  it('applies success variant styles', () => {
    render(<Badge variant="success">Hot</Badge>);
    const badge = screen.getByText('Hot');
    expect(badge.className).toContain('text-accent');
  });

  it('applies warning variant styles', () => {
    render(<Badge variant="warning">Warm</Badge>);
    const badge = screen.getByText('Warm');
    expect(badge.className).toContain('text-yellow-400');
  });

  it('applies danger variant styles', () => {
    render(<Badge variant="danger">Cold</Badge>);
    const badge = screen.getByText('Cold');
    expect(badge.className).toContain('text-red-400');
  });

  it('applies info variant styles', () => {
    render(<Badge variant="info">Info</Badge>);
    const badge = screen.getByText('Info');
    expect(badge.className).toContain('text-blue-400');
  });

  it('merges custom className', () => {
    render(<Badge className="extra">Tag</Badge>);
    const badge = screen.getByText('Tag');
    expect(badge.className).toContain('extra');
  });
});
