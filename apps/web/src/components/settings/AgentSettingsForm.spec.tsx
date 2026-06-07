import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentSettingsForm } from './AgentSettingsForm';
import type { AgentSettings } from '@/types';

const mockSettings: AgentSettings = {
  id: '1',
  agentName: 'Assistente Decodifica',
  initialMessage: 'Olá, como posso ajudar?',
  toneOfVoice: 'Profissional e amigável',
  services: ['Automação WhatsApp', 'Chatbots'],
  doNotPromise: ['Prazos fixos'],
  handoffCriteria: ['Score acima de 70'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const defaultProps = {
  settings: mockSettings,
  isLoading: false,
  isSaving: false,
  saveError: null,
  saveSuccess: false,
  onSave: vi.fn(),
  onResetSaveState: vi.fn(),
};

describe('AgentSettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton when isLoading is true', () => {
    render(<AgentSettingsForm {...defaultProps} isLoading={true} />);
    expect(screen.queryByLabelText(/Nome do Agente/)).not.toBeInTheDocument();
  });

  it('populates form fields from settings', () => {
    render(<AgentSettingsForm {...defaultProps} />);
    expect(screen.getByDisplayValue('Assistente Decodifica')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Olá, como posso ajudar?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Profissional e amigável')).toBeInTheDocument();
    expect(screen.getByText('Automação WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Chatbots')).toBeInTheDocument();
    expect(screen.getByText('Prazos fixos')).toBeInTheDocument();
    expect(screen.getByText('Score acima de 70')).toBeInTheDocument();
  });

  it('shows validation errors when required fields are empty', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AgentSettingsForm
        {...defaultProps}
        settings={{ ...mockSettings, agentName: '', initialMessage: '' }}
        onSave={onSave}
      />
    );

    // Clear the fields (they start empty from settings)
    await user.click(screen.getByRole('button', { name: /Salvar configurações/ }));

    expect(screen.getByText('Nome do agente é obrigatório')).toBeInTheDocument();
    expect(screen.getByText('Mensagem inicial é obrigatória')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with form data when valid', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AgentSettingsForm {...defaultProps} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /Salvar configurações/ }));

    expect(onSave).toHaveBeenCalledWith({
      agentName: 'Assistente Decodifica',
      initialMessage: 'Olá, como posso ajudar?',
      toneOfVoice: 'Profissional e amigável',
      services: ['Automação WhatsApp', 'Chatbots'],
      doNotPromise: ['Prazos fixos'],
      handoffCriteria: ['Score acima de 70'],
    });
  });

  it('shows success message when saveSuccess is true', () => {
    render(<AgentSettingsForm {...defaultProps} saveSuccess={true} />);
    expect(screen.getByText('Configurações salvas com sucesso')).toBeInTheDocument();
  });

  it('shows error message when saveError is set', () => {
    render(
      <AgentSettingsForm
        {...defaultProps}
        saveError="Falha ao salvar configurações"
      />
    );
    expect(screen.getByText('Falha ao salvar configurações')).toBeInTheDocument();
  });

  it('shows loading state on save button when isSaving', () => {
    render(<AgentSettingsForm {...defaultProps} isSaving={true} />);
    const button = screen.getByRole('button', { name: /Salvar configurações/ });
    expect(button).toBeDisabled();
  });
});
