import type { DayfitApi } from '../../preload/index.d'

export type { ViewState } from '../../main/service'
export type { Item, NewItem, Settings, DecisionAnswer } from '../../core/types'
export type { DayfitApi, FocusTarget } from '../../preload/index.d'

/** Typed handle to the preload bridge. */
export const api: DayfitApi = window.dayfit
