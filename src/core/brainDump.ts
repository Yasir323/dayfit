import { parseLine, type ParsedLine } from './parser'
import type { DateStr } from './types'

export function parseBrainDump(text: string, today: DateStr): ParsedLine[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => parseLine(l, today))
}
