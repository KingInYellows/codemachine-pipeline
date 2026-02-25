import { z } from 'zod';
import type { ContextDocument, ContextSummary } from '../../core/models/ContextDocument';

// ============================================================================
// Types
// ============================================================================

/**
 * File chunk for summarization
 */
export interface FileChunk {
  /** Chunk content */
  content: string;
  /** Chunk index (0-based) */
  index: number;
  /** Total number of chunks for this file */
  total: number;
  /** Estimated token count for chunk */
  tokenCount: number;
  /** Start byte offset in original file */
  startOffset: number;
  /** End byte offset in original file */
  endOffset: number;
}

/**
 * Summary response from provider
 */
export interface SummaryResponse {
  /** Summary text */
  summary: string;
  /** Prompt tokens used */
  promptTokens: number;
  /** Completion tokens used */
  completionTokens: number;
  /** Model identifier */
  model?: string;
  /** Redaction flags applied */
  redactionFlags?: string[];
}

/**
 * Summarizer client interface (provider-agnostic)
 */
export interface SummarizerClient {
  /**
   * Summarize a chunk of text
   */
  summarizeChunk(
    text: string,
    options?: { streaming?: boolean; context?: string }
  ): Promise<SummaryResponse>;

  /**
   * Get provider identifier
   */
  getProviderId(): string;
}

/**
 * Chunk metadata stored for caching
 */
export interface ChunkMetadata {
  /** Chunk ID (hash-based) */
  chunkId: string;
  /** Source file path */
  path: string;
  /** Source file SHA-256 hash */
  fileSha: string;
  /** Chunk index */
  chunkIndex: number;
  /** Chunk total count */
  chunkTotal: number;
  /** Summary text */
  summary: string;
  /** Token counts */
  tokenCount: {
    prompt: number;
    completion: number;
  };
  /** Generation timestamp */
  generatedAt: string;
  /** Provider/model used */
  generatedBy: string;
  /** Summarization method */
  summarizationMethod: string;
  /** Redaction flags */
  redactionFlags: string[];
}

export const ChunkMetadataSchema = z.object({
  chunkId: z.string(),
  path: z.string(),
  fileSha: z.string(),
  chunkIndex: z.number().nonnegative(),
  chunkTotal: z.number().positive(),
  summary: z.string(),
  tokenCount: z.object({
    prompt: z.number().nonnegative(),
    completion: z.number().nonnegative(),
  }),
  generatedAt: z.string(),
  generatedBy: z.string(),
  summarizationMethod: z.string(),
  redactionFlags: z.array(z.string()),
});

/**
 * Convert chunk metadata to ContextSummary entry
 */
export function toContextSummary(metadata: ChunkMetadata): ContextSummary {
  return {
    chunk_id: metadata.chunkId,
    file_path: metadata.path,
    file_sha: metadata.fileSha,
    chunk_index: metadata.chunkIndex,
    chunk_total: metadata.chunkTotal,
    summary: metadata.summary,
    token_count: metadata.tokenCount.prompt + metadata.tokenCount.completion,
    generated_at: metadata.generatedAt,
    generated_by: metadata.generatedBy,
    method: metadata.summarizationMethod,
    redaction_flags: metadata.redactionFlags,
  };
}

/**
 * Summarization configuration
 */
export interface SummarizerConfig {
  /** Repository root directory */
  repoRoot: string;
  /** Run directory path */
  runDir: string;
  /** Feature ID */
  featureId: string;
  /** Maximum tokens per chunk (default: 4000) */
  maxTokensPerChunk?: number;
  /** Chunk overlap percentage (default: 10) */
  chunkOverlapPercent?: number;
  /** Token budget limit */
  tokenBudget?: number;
  /** Enable summarization */
  enableSummarization?: boolean;
  /** Force re-summarize (ignore cache) */
  forceFresh?: boolean;
}

/**
 * Summarization result for a single document
 */
export interface SummarizationResult {
  /** Context document with summaries */
  contextDocument: ContextDocument;
  /** Chunks generated */
  chunksGenerated: number;
  /** Chunks cached (reused) */
  chunksCached: number;
  /** Total tokens used */
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Warnings */
  warnings: string[];
}

/**
 * Batch summarization result
 */
export interface BatchSummarizationResult {
  /** Summarized documents */
  documents: ContextDocument[];
  /** Total chunks generated */
  totalChunksGenerated: number;
  /** Total chunks cached */
  totalChunksCached: number;
  /** Total tokens used */
  totalTokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Warnings */
  warnings: string[];
  /** Errors */
  errors: string[];
}
