import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QualificationPanel } from './QualificationPanel';
import type { QualificationData } from '@/types';

const mockQualification: QualificationData = {
  stage: 'descoberta',
  detectedSegment: 'Clínica odontológica',
  detectedIntent: 'vendas',
  mainPain: 'Demora no agendamento pelo WhatsApp',
  recommendedService: 'Automação de agendamento',
  leadScore: 45,
  temperature: 'morno',
  status: 'qualificando',
  shouldHandoff: false,
  handoffReason: null,
  commercialSummary: 'Lead com potencial médio, precisa de automação de agendamento.',
  nextBestQuestion: 'Quantos agendamentos vocês fazem por dia?',
  scoreReasons: ['Negócio identificado (+15)', 'Dor identificada (+20)'],
  objections: ['Preço pode ser alto'],
  urgency: 'media',
  estimatedVolume: 'medio',
  decisionRole: 'dono',
  budgetSignal: 'medio',
};

describe('QualificationPanel', () => {
  it('renders placeholder when qualification is null', () => {
    render(<QualificationPanel qualification={null} />);
    expect(screen.getByText('Aguardando primeira mensagem...')).toBeInTheDocument();
  });

  it('displays score with progress bar', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('45/100')).toBeInTheDocument();
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '45');
    expect(progressBar).toHaveStyle({ width: '45%' });
  });

  it('displays temperature as a colored badge', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('Morno')).toBeInTheDocument();
  });

  it('displays status badge', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('Qualificando')).toBeInTheDocument();
  });

  it('displays stage', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('Descoberta')).toBeInTheDocument();
  });

  it('displays segment, intent, pain, recommended service', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('Clínica odontológica')).toBeInTheDocument();
    expect(screen.getByText('vendas')).toBeInTheDocument();
    expect(screen.getByText('Demora no agendamento pelo WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Automação de agendamento')).toBeInTheDocument();
  });

  it('displays urgency and volume', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('media')).toBeInTheDocument();
    expect(screen.getByText('medio')).toBeInTheDocument();
  });

  it('displays commercial summary in a card-like container', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(
      screen.getByText('Lead com potencial médio, precisa de automação de agendamento.')
    ).toBeInTheDocument();
  });

  it('displays next question highlighted', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    const nextQuestion = screen.getByText('Quantos agendamentos vocês fazem por dia?');
    expect(nextQuestion).toBeInTheDocument();
    expect(nextQuestion.className).toContain('text-accent');
  });

  it('displays score reasons as a list', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('Negócio identificado (+15)')).toBeInTheDocument();
    expect(screen.getByText('Dor identificada (+20)')).toBeInTheDocument();
  });

  it('displays objections as a list', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.getByText('Preço pode ser alto')).toBeInTheDocument();
  });

  it('shows handoff badge when shouldHandoff is true', () => {
    const handoffData: QualificationData = {
      ...mockQualification,
      shouldHandoff: true,
      handoffReason: 'Lead atingiu score 70, pronto para atendimento humano.',
    };
    render(<QualificationPanel qualification={handoffData} />);
    expect(screen.getByText('Chamar Humano')).toBeInTheDocument();
    expect(
      screen.getByText('Lead atingiu score 70, pronto para atendimento humano.')
    ).toBeInTheDocument();
  });

  it('does not show handoff badge when shouldHandoff is false', () => {
    render(<QualificationPanel qualification={mockQualification} />);
    expect(screen.queryByText('Chamar Humano')).not.toBeInTheDocument();
    expect(screen.getByText('Não necessário')).toBeInTheDocument();
  });

  it('shows placeholder for null fields', () => {
    const nullData: QualificationData = {
      stage: 'abertura',
      detectedSegment: null,
      detectedIntent: null,
      mainPain: null,
      recommendedService: null,
      leadScore: null,
      temperature: null,
      status: null,
      shouldHandoff: false,
      handoffReason: null,
      commercialSummary: null,
      nextBestQuestion: null,
      scoreReasons: null,
      objections: null,
      urgency: null,
      estimatedVolume: null,
      decisionRole: null,
      budgetSignal: null,
    };
    render(<QualificationPanel qualification={nullData} />);
    // Score and other null fields show "—" placeholder
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
    // Null text fields show "Não informado" placeholder
    const placeholders = screen.getAllByText('Não informado');
    expect(placeholders.length).toBeGreaterThan(0);
  });

  it('displays temperature badge with correct variant for frio', () => {
    const frioData: QualificationData = {
      ...mockQualification,
      temperature: 'frio',
      leadScore: 20,
    };
    render(<QualificationPanel qualification={frioData} />);
    expect(screen.getByText('Frio')).toBeInTheDocument();
  });

  it('displays temperature badge with correct variant for quente', () => {
    const quenteData: QualificationData = {
      ...mockQualification,
      temperature: 'quente',
      leadScore: 85,
    };
    render(<QualificationPanel qualification={quenteData} />);
    expect(screen.getByText('Quente')).toBeInTheDocument();
  });
});
