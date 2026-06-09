import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

/**
 * Transcreve áudios (voice/ptt do WhatsApp) em texto via Groq Whisper, para o
 * agente "ouvir" o cliente. É opcional e defensivo: sem GROQ_API_KEY, ou em
 * qualquer falha, retorna `null` e o chamador trata caindo no aviso de mídia —
 * nunca derruba o fluxo nem expõe erro técnico ao cliente.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  /** Timeout duro da chamada de transcrição (cabe dentro do ENGINE_TIMEOUT). */
  private static readonly REQUEST_TIMEOUT_MS = 18_000;

  constructor(private readonly config: AppConfigService) {}

  /** Habilitada apenas quando há GROQ_API_KEY configurada. */
  get isEnabled(): boolean {
    return !!this.config.groqApiKey;
  }

  /**
   * Transcreve um áudio (em base64) e devolve o texto, ou `null` quando
   * desabilitado, vazio ou em erro.
   */
  async transcribe(base64: string, mimetype: string): Promise<string | null> {
    const apiKey = this.config.groqApiKey;
    if (!apiKey || !base64) return null;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return null;
    }
    if (buffer.length === 0) return null;

    const { filename, type } = this.fileMeta(mimetype);
    const bytes = Uint8Array.from(buffer);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), filename);
    form.append('model', this.config.groqSttModel);
    form.append('language', 'pt');
    form.append('response_format', 'json');

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      TranscriptionService.REQUEST_TIMEOUT_MS,
    );
    try {
      const url = `${this.config.groqBaseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.warn(
          `Groq transcription failed: ${res.status} ${detail.slice(0, 200)}`,
        );
        return null;
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text || '').trim();
      if (!text) return null;
      this.logger.debug(`Transcribed audio (${buffer.length}B) -> ${text.length} chars`);
      return text;
    } catch (err) {
      this.logger.warn(
        `Groq transcription error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Nome/MIME do arquivo conforme o mimetype do WhatsApp (default ogg/opus). */
  private fileMeta(mimetype: string): { filename: string; type: string } {
    const mt = (mimetype || '').toLowerCase();
    if (mt.includes('ogg') || mt.includes('opus'))
      return { filename: 'audio.ogg', type: 'audio/ogg' };
    if (mt.includes('mpeg') || mt.includes('mp3'))
      return { filename: 'audio.mp3', type: 'audio/mpeg' };
    if (mt.includes('mp4') || mt.includes('m4a'))
      return { filename: 'audio.m4a', type: 'audio/mp4' };
    if (mt.includes('wav')) return { filename: 'audio.wav', type: 'audio/wav' };
    if (mt.includes('webm')) return { filename: 'audio.webm', type: 'audio/webm' };
    return { filename: 'audio.ogg', type: 'audio/ogg' };
  }
}
