/**
 * Minimal strongly-typed synchronous event bus.
 * The event map is declared centrally in `GameEvents` so producers and
 * consumers share a single contract.
 */
export class EventBus<Events extends object> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(handler);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (const h of list.slice()) h(payload);
  }
}
