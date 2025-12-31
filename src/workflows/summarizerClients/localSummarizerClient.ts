import { estimateTokens } from '../contextRanking';
import type { SummarizerClient, SummaryResponse } from '../contextSummarizer';

/**
 * LocalSummarizerClient
 *
 * Lightweight summarizer that truncates and normalizes content to provide
 * deterministic summaries without external provider calls. Intended as a
 * development fallback until agent manifests wire up remote providers.
 */
export class LocalSummarizerClient implements SummarizerClient {
  constructor(private readonly maxSummaryLength = 600) {}

  summarizeChunk(text: string): Promise<SummaryResponse> {
    const summary = this.buildSummary(text);
    return Promise.resolve({
      summary,
      promptTokens: estimateTokens(Buffer.byteLength(text, 'utf-8')),
      completionTokens: estimateTokens(Buffer.byteLength(summary, 'utf-8')),
      model: 'local-summarizer',
    });
  }

  getProviderId(): string {
    return 'local';
  }

  private buildSummary(text: string): string {
    const normalized = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');

    if (normalized.length <= this.maxSummaryLength) {
      return normalized;
    }

    return `${normalized.slice(0, this.maxSummaryLength - 3)}...`;
  }
}
