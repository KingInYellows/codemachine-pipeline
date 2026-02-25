import { createHash } from 'node:crypto';
import { estimateTokens } from './contextRanking';
import type { FileChunk } from './summarizerClients/types';

// ============================================================================
// Chunking Logic
// ============================================================================

function chunkByFixedWidth(content: string, maxChars: number): FileChunk[] {
  const chunks: FileChunk[] = [];
  let cursor = 0;
  let byteOffset = 0;

  while (cursor < content.length) {
    const slice = content.slice(cursor, cursor + maxChars);
    const sliceBytes = Buffer.byteLength(slice, 'utf-8');
    const tokenCount = estimateTokens(sliceBytes);

    chunks.push({
      content: slice,
      index: chunks.length,
      total: 0,
      tokenCount,
      startOffset: byteOffset,
      endOffset: byteOffset + sliceBytes,
    });

    cursor += maxChars;
    byteOffset += sliceBytes;
  }

  const total = chunks.length;
  chunks.forEach((chunk) => {
    chunk.total = total;
  });

  return chunks;
}

export function chunkFile(
  content: string,
  maxTokens = 4000,
  overlapPercent = 10
): FileChunk[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const chunks: FileChunk[] = [];

  // Estimate characters per token (heuristic: ~4 chars/token)
  const charsPerToken = 4;
  const maxCharsPerChunk = maxTokens * charsPerToken;
  const overlapChars = Math.floor(maxCharsPerChunk * (overlapPercent / 100));

  // Split content into lines for semantic boundary preservation
  const lines = content.split('\n');

  if (!content.includes('\n') && Buffer.byteLength(content, 'utf-8') > maxCharsPerChunk) {
    return chunkByFixedWidth(content, maxCharsPerChunk);
  }

  let currentChunk = '';
  let currentStartOffset = 0;
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineWithNewline = i < lines.length - 1 ? `${line}\n` : line;

    // Check if adding this line would exceed chunk size
    if (
      currentChunk.length > 0 &&
      currentChunk.length + lineWithNewline.length > maxCharsPerChunk
    ) {
      // Finalize current chunk
      const tokenCount = estimateTokens(Buffer.byteLength(currentChunk, 'utf-8'));
      chunks.push({
        content: currentChunk,
        index: chunks.length,
        total: 0, // Will update after all chunks are created
        tokenCount,
        startOffset: currentStartOffset,
        endOffset: lineOffset,
      });

      // Start new chunk with overlap
      const overlapStartIndex = Math.max(0, i - Math.floor(overlapChars / 50)); // ~50 chars per line
      currentChunk = lines.slice(overlapStartIndex, i + 1).join('\n');
      if (overlapStartIndex < i) {
        currentChunk += '\n';
      }
      currentStartOffset =
        lineOffset - Buffer.byteLength(lines.slice(overlapStartIndex, i).join('\n'), 'utf-8');
    } else {
      currentChunk += lineWithNewline;
    }

    lineOffset += Buffer.byteLength(lineWithNewline, 'utf-8');
  }

  // Add final chunk if any content remains
  if (currentChunk.trim().length > 0) {
    const tokenCount = estimateTokens(Buffer.byteLength(currentChunk, 'utf-8'));
    chunks.push({
      content: currentChunk,
      index: chunks.length,
      total: 0,
      tokenCount,
      startOffset: currentStartOffset,
      endOffset: lineOffset,
    });
  }

  // Update total count for all chunks
  const totalChunks = chunks.length;
  chunks.forEach((chunk) => {
    chunk.total = totalChunks;
  });

  return chunks;
}

// ============================================================================
// Chunk ID Generation
// ============================================================================

/**
 * Generate chunk ID from file path, SHA, and chunk index
 */
export function generateChunkId(filePath: string, fileSha: string, chunkIndex: number): string {
  const input = `${filePath}:${fileSha}:${chunkIndex}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}
