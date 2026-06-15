import { Injectable } from '@nestjs/common';
import {
  ConversationSnapshot,
  EligibilityResult,
} from './followup.types';

/**
 * Centraliza toda a regra de elegibilidade de uma Conversation para follow-up
 * (R2.1, R4.1), conforme a seção "FollowUpEligibilityService" do design
 * (.kiro/specs/lead-followup/design.md).
 *
 * Recebe um snapshot imutável dos campos relevantes da Conversation e do Lead
 * e devolve a decisão. Não faz I/O: a avaliação é uma função TOTAL e
 * determinística — o mesmo snapshot sempre produz o mesmo resultado —, o que a
 * torna facilmente testável por propriedades.
 */
@Injectable()
export class FollowUpEligibilityService {
  /**
   * Avalia a elegibilidade de uma Conversation para follow-up (R2.1, R4.1).
   *
   * Não elegível por `handoff_humano` quando qualquer condição de
   * encaminhamento ao humano for verdadeira; essas condições têm precedência
   * sobre o status `perdido`. Não elegível por `lead_perdido` quando o status
   * do lead é `perdido` e essa é a única causa. Caso contrário, elegível.
   */
  evaluate(snapshot: ConversationSnapshot): EligibilityResult {
    const handoff =
      snapshot.leadStatus === 'chamar_humano' ||
      snapshot.handoffAccepted ||
      snapshot.handoffCompleted ||
      snapshot.stage === 'handoff_humano' ||
      snapshot.botPaused ||
      (snapshot.assignedTo !== null && snapshot.assignedTo !== '');

    if (handoff) {
      return { eligible: false, reason: 'handoff_humano' };
    }

    if (snapshot.leadStatus === 'perdido') {
      return { eligible: false, reason: 'lead_perdido' };
    }

    return { eligible: true, reason: null };
  }
}
