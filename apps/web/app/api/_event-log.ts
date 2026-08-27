import type { ArmorEvent } from "vercel-armor";

const MAX = 60;

type Entry = ArmorEvent & { at: number };

const buf: Entry[] = [];

export function recordEvent(evt: ArmorEvent): void {
  buf.push({ ...evt, at: Date.now() });
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

export function readEvents(): readonly Entry[] {
  return buf;
}

export function clearEvents(): void {
  buf.length = 0;
}
