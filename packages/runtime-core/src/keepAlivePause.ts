import type { GenericComponentInstance } from './component'
import {
  restoreCurrentInstance,
  setCurrentInstance,
} from './componentCurrentInstance'
import { flushOwnedJobs } from './scheduler'

const enum EntryState {
  DEACTIVATING,
  PAUSED,
}

// Kept apart from the scope's own pause, which user code can also set.
const entries = new WeakMap<GenericComponentInstance, EntryState>()

/**
 * An entry counts as paused from its deactivation on, though its scope only
 * pauses once its deactivated hooks have run.
 * @internal
 */
export function isPausedKeepAliveEntry(
  instance: GenericComponentInstance,
): boolean {
  return entries.has(instance)
}

/**
 * Marks a component KeepAlive is deactivating, to be paused by
 * `pauseKeepAliveEntry` once its deactivated hooks have run.
 * @internal
 */
export function requestPauseKeepAliveEntry(
  instance: GenericComponentInstance,
): void {
  if (!entries.has(instance)) {
    entries.set(instance, EntryState.DEACTIVATING)
  }
}

/**
 * Pauses a deactivated entry, with its subtree, after the updates its
 * deactivated hooks made, e.g. closing a teleported modal. An entry activated
 * or unmounted in the meantime is left alone.
 * @internal
 */
export function pauseKeepAliveEntry(instance: GenericComponentInstance): void {
  if (
    entries.get(instance) === EntryState.DEACTIVATING &&
    instance.scope.active
  ) {
    flushOwnedJobs(instance)
    entries.set(instance, EntryState.PAUSED)
    instance.scope.pause()
  }
}

/**
 * Resumes a paused entry. Its effects catch up now, with the work queued
 * inside it, as they would have while it was deactivated; `update` runs
 * before that work, so that a render it starts includes it. Returns an error
 * one of them threw, for the caller to rethrow once the entry is in place.
 * @internal
 */
export function resumeKeepAliveEntry(
  root: GenericComponentInstance,
  update?: () => void,
): { error: unknown } | undefined {
  const paused = entries.get(root) === EntryState.PAUSED
  entries.delete(root)
  if (!paused && !update) return
  let failure: { error: unknown } | undefined
  // outside the activating component, as in a scheduler flush
  const prev = setCurrentInstance(null)
  if (paused) {
    try {
      root.scope.resume()
    } catch (error) {
      failure = { error }
    }
  }
  if (update) {
    try {
      update()
    } catch (error) {
      failure ||= { error }
    }
  }
  if (paused) {
    try {
      flushOwnedJobs(root)
    } catch (error) {
      failure ||= { error }
    }
  }
  restoreCurrentInstance(prev)
  return failure
}
