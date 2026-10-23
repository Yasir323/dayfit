import { createContext } from 'react'
import type { Item } from '../../../core/types'

/** Lets any item row open the edit overlay without threading a prop through every view. */
export const EditContext = createContext<((item: Item) => void) | null>(null)
