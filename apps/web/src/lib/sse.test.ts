import type { ChatEvent } from '@docchat/shared';
import { describe, expect, it } from 'vitest';
import { parseSse } from './sse';

/** A stream that delivers `text` split into the given chunk sizes (in bytes). */
function streamOf(text: string, chunkSizes?: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of chunkSizes ?? [bytes.length]) {
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  if (offset < bytes.length) chunks.push(bytes.slice(offset));
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events: ChatEvent[] = [];
  for await (const e of parseSse(stream)) events.push(e);
  return events;
}

const frame = (e: ChatEvent) => `data: ${JSON.stringify(e)}\n\n`;
const delta = (text: string): ChatEvent => ({ type: 'delta', text });

describe('parseSse', () => {
  it('parses several events delivered in one chunk', async () => {
    const events = await collect(streamOf(frame(delta('a')) + frame(delta('b'))));
    expect(events).toEqual([delta('a'), delta('b')]);
  });

  it('reassembles an event split across chunks', async () => {
    const text = frame(delta('hello world'));
    const events = await collect(streamOf(text, [3, 10, 5]));
    expect(events).toEqual([delta('hello world')]);
  });

  it('does not corrupt a multi-byte character split between chunks', async () => {
    const text = frame(delta('£29 — café'));
    const poundSign = text.indexOf('£');
    // Split inside the two-byte encoding of "£".
    const events = await collect(streamOf(text, [poundSign + 1]));
    expect(events).toEqual([delta('£29 — café')]);
  });

  it('handles CRLF line endings and ignores comment frames', async () => {
    const text = `: keep-alive\r\n\r\n${frame(delta('x')).replace(/\n/g, '\r\n')}`;
    expect(await collect(streamOf(text))).toEqual([delta('x')]);
  });

  it('treats a CRLF split across chunks as one line break', async () => {
    const text = `data: ${JSON.stringify(delta('a'))}\r\n\r\n`;
    const crIndex = text.indexOf('\r');
    // Chunk 1 ends with "\r"; chunk 2 starts with "\n\r\n".
    expect(await collect(streamOf(text, [crIndex + 1]))).toEqual([delta('a')]);
  });

  it('parses a final event that has no trailing blank line', async () => {
    expect(await collect(streamOf(`data: ${JSON.stringify(delta('end'))}`))).toEqual([
      delta('end'),
    ]);
  });

  it('rejects events that do not match the contract', async () => {
    await expect(collect(streamOf('data: {"type":"mystery"}\n\n'))).rejects.toThrow(
      /Unexpected event/,
    );
  });
});
