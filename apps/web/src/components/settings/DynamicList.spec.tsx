import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DynamicList } from './DynamicList';

describe('DynamicList', () => {
  const defaultProps = {
    label: 'Serviços',
    items: ['Item 1', 'Item 2'],
    maxItems: 5,
    maxItemLength: 200,
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders label and item count', () => {
    render(<DynamicList {...defaultProps} />);
    expect(screen.getByText('Serviços')).toBeInTheDocument();
    expect(screen.getByText('2/5 itens')).toBeInTheDocument();
  });

  it('renders existing items', () => {
    render(<DynamicList {...defaultProps} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('adds a new item when clicking Adicionar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DynamicList {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText(/Adicionar item/);
    await user.type(input, 'New Item');
    await user.click(screen.getByRole('button', { name: /Adicionar/ }));

    expect(onChange).toHaveBeenCalledWith(['Item 1', 'Item 2', 'New Item']);
  });

  it('adds a new item on Enter key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DynamicList {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText(/Adicionar item/);
    await user.type(input, 'Enter Item{Enter}');

    expect(onChange).toHaveBeenCalledWith(['Item 1', 'Item 2', 'Enter Item']);
  });

  it('removes an item when clicking the X button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DynamicList {...defaultProps} onChange={onChange} />);

    const removeButtons = screen.getAllByRole('button', { name: /Remover/ });
    await user.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith(['Item 2']);
  });

  it('disables input when max items reached', () => {
    render(
      <DynamicList
        {...defaultProps}
        items={['a', 'b', 'c', 'd', 'e']}
        maxItems={5}
      />
    );

    const input = screen.getByPlaceholderText(/Adicionar item/);
    expect(input).toBeDisabled();
  });

  it('does not add empty items', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DynamicList {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText(/Adicionar item/);
    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: /Adicionar/ }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
