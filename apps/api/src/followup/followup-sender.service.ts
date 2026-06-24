import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { RateLimiterService } from '../common/rate-limiter';
import { ChannelAdapterRegistry } from '../channel/channel-adapter.registry';
import type { ChannelName } from '../channel/channel-adapter.interface';
import type { SendOutcome } from './followup.types';

/** WhatsApp channel literal, matching the inbound/outbound flow. */
const WHATSAPP_CHANNEL: ChannelName = 'whatsapp';

/** Minutos em um dia, usado no cálculo da janela de envio. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * Fuso horário de referência da janela de envio (R9.2).
 *
 * Suposição documentada: a `FOLLOWUP_SEND_WINDOW` (ex.: `08:00-20:00`) é
 * interpretada no fuso de operação comercial **America/Sao_Paulo**, conforme o
 * design. O parâmetro `now` chega como um `Date` (instante absoluto/UTC) e é
 * convertido para a hora local desse fuso para decidir se está dentro da
 * janela — assim a regra independe do fuso do servidor.
 */
const SEND_WINDOW_TIME_ZONE = 'America/Sao_Paulo';

/**
 * Encapsula o envio de uma Reengagement_Message pelo WhatsApp respeitando a
 * janela de envio permitida e o limitador de frequência (Requisito 9).
 *
 * Este serviço **não** decide elegibilidade nem idempotência do nível: ele
 * apenas tenta entregar a mensagem e classifica o resultado em um
 * {@link SendOutcome}. A marcação do nível como enviado, a atualização de
 * `lastOutboundAt` e o registro de eventos (`BotEvent`) são responsabilidade do
 * `FollowUpService`/`FollowUpEventRecorder` — aqui apenas devolvemos o `sentAt`
 * em caso de sucesso.
 *
 * Reaproveita a infraestrutura existente:
 *  - {@link ChannelAdapterRegistry} para resolver o adapter do WhatsApp
 *    (Evolution) e enviar o texto via `sendMessage`, exatamente como o
 *    `InboundMessageProcessor` faz no fluxo de resposta do bot.
 *  - {@link RateLimiterService} (token bucket) com chave por telefone, coerente
 *    com o uso no inbound (`tryConsume(phone)`).
 *  - {@link AppConfigService} para a janela de envio já analisada
 *    (`followUpSendWindowParsed`).
 */
@Injectable()
export class FollowUpSender {
  private readonly logger = new Logger(FollowUpSender.name);

  constructor(
    private readonly channelRegistry: ChannelAdapterRegistry,
    private readonly rateLimiter: RateLimiterService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Envia a Reengagement_Message pelo WhatsApp (R9):
   *  - fora da janela permitida → `deferred(out_of_window)` (R9.2), mantendo o
   *    nível como não enviado;
   *  - `RateLimiter` rejeita → `deferred(rate_limited)` (R9.3), sem marcar o
   *    nível como enviado;
   *  - envio confirmado pelo Evolution → `sent(sentAt)` (R9.1, R9.6), devolvendo
   *    o instante do envio para o `FollowUpService` atualizar `lastOutboundAt`;
   *  - falha/exceção do Evolution → `failed(evolution_error)` (R9.4), mantendo o
   *    nível como não enviado.
   *
   * @param params.phone - Número de telefone do destinatário (chave do limiter).
   * @param params.instanceName - Instância do Evolution (null usa o default).
   * @param params.conversationId - Conversa de origem (correlação/log).
   * @param params.content - Texto já composto da mensagem de reengajamento.
   * @param params.now - Relógio injetado (instante do disparo).
   */
  async send(params: {
    phone: string;
    instanceName: string | null;
    conversationId: string;
    content: string;
    now: Date;
    bypassWindow?: boolean;
  }): Promise<SendOutcome> {
    const { phone, instanceName, conversationId, content, now, bypassWindow } =
      params;

    // R9.2 — fora da janela permitida: adia sem marcar enviado. Exceção: quando
    // o próprio cliente marcou o horário (adiamento pedido — bypassWindow), o
    // disparo honra o compromisso e fura a janela comercial; a janela só vale
    // pro follow-up automático (1h/1d/2d), pra não incomodar fora de hora.
    if (!bypassWindow && !this.isWithinSendWindow(now)) {
      return { status: 'deferred', reason: 'out_of_window' };
    }

    // R9.3 — Rate_Limiter rejeita: adia, mantém pendente sem marcar enviado.
    if (!this.rateLimiter.tryConsume(phone, now.getTime())) {
      return { status: 'deferred', reason: 'rate_limited' };
    }

    // R9.1 — envio pelo Evolution via ChannelAdapter do WhatsApp.
    try {
      await this.channelRegistry.get(WHATSAPP_CHANNEL).sendMessage({
        to: phone,
        content,
        instanceName: instanceName ?? undefined,
        conversationId,
      });
    } catch (err) {
      // R9.4 — falha do Evolution: nível permanece não enviado.
      this.logger.error(
        `Falha ao enviar follow-up via Evolution (conversation=${conversationId}): ${this.errMsg(err)}`,
      );
      return { status: 'failed', reason: 'evolution_error' };
    }

    // R9.6 — Evolution confirmou: devolve o instante do envio confirmado.
    return { status: 'sent', sentAt: now };
  }

  /**
   * Retorna `true` quando `now` está dentro da janela de envio configurada
   * (`FOLLOWUP_SEND_WINDOW`, ex.: `08:00-20:00`), avaliada no fuso
   * {@link SEND_WINDOW_TIME_ZONE} (R9.2).
   *
   * A janela é tratada como `[início, fim)` (início inclusivo, fim exclusivo).
   * Janelas que cruzam a meia-noite (início > fim, ex.: `20:00-06:00`) também
   * são suportadas.
   */
  isWithinSendWindow(now: Date): boolean {
    const { startHour, startMinute, endHour, endMinute } =
      this.config.followUpSendWindowParsed;

    const nowMinutes = this.minutesOfDayInZone(now);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    // Janela normal dentro do mesmo dia (ex.: 08:00-20:00).
    if (startMinutes <= endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }

    // Janela que cruza a meia-noite (ex.: 20:00-06:00).
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }

  /**
   * Converte um instante absoluto para o número de minutos decorridos desde a
   * meia-noite no fuso {@link SEND_WINDOW_TIME_ZONE}.
   */
  private minutesOfDayInZone(now: Date): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SEND_WINDOW_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    let hour = 0;
    let minute = 0;
    for (const part of formatter.formatToParts(now)) {
      if (part.type === 'hour') {
        // `hour12: false` pode produzir '24' à meia-noite em alguns ambientes.
        hour = Number(part.value) % 24;
      } else if (part.type === 'minute') {
        minute = Number(part.value);
      }
    }

    return ((hour * 60 + minute) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }

  /** Extrai uma mensagem legível de um erro desconhecido para log. */
  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
