import { ChatEvent } from '@docchat/shared';

/**
 * Parses a Server-Sent Events byte stream into validated ChatEvents.
 *
 * Network chunks don't line up with events: one chunk can hold several
 * events, or end halfway through one (or halfway through a multi-byte UTF-8
 * character). So bytes are decoded in streaming mode and buffered until a
 * blank line marks the end of an event.
 */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = stream.getReader();
  // `stream: true` keeps a multi-byte character split across chunks intact.
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A chunk may end between the \r and \n of a CRLF; hold the \r back so
      // the pair isn't counted as two line breaks.
      const heldCr = buffer.endsWith('\r');
      buffer = (heldCr ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
      if (heldCr) buffer += '\r';
    }
    buffer += decoder.decode();
    const trailing = parseFrame(buffer.replace(/\r\n?/g, '\n'));
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

/** Joins the `data:` lines of one frame and validates it against the contract. */
function parseFrame(frame: string): ChatEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return null; // comments / keep-alives

  const parsed = ChatEvent.safeParse(JSON.parse(data));
  if (!parsed.success) {
    throw new Error(`Unexpected event from server: ${parsed.error.message}`);
  }
  return parsed.data;
}
