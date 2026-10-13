// Team fights: an attack is worked out once for its main target and then re-run, silently, against everyone
// else who might be in the way. While those "what if" passes run, effects, sounds and screen shake are muted
// (only an actual hit on someone shows). FX.mute > 0 means muted.
export const FX = { mute: 0 };

/** wrap every method of an object (or prototype) so it does nothing while FX.mute is set */
export function muteable(target: any, names: string[]) {
  for (const k of names) {
    const f = target[k];
    if (typeof f !== 'function' || f.__tqMute) continue;
    const w = function (this: any, ...a: any[]) {
      if (FX.mute > 0) return undefined;
      return f.apply(this, a);
    };
    (w as any).__tqMute = true;
    target[k] = w;
  }
}
