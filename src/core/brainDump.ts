import { parseLine, type ParsedLine } from './parser'
import type { DateStr } from './types'

/** Non-empty trimmed lines of a brain dump, in order. */
export function splitDumpLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

export function parseBrainDump(text: string, today: DateStr): ParsedLine[] {
  return splitDumpLines(text).map((l) => parseLine(l, today))
}
