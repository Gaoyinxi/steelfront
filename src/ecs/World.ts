/**
 * Lightweight ECS core.
 *
 * - Entities are integer ids.
 * - Components are plain data objects stored per type in a Map<Entity, T>.
 * - Component types are typed tokens created by `defineComponent<T>()`, giving
 *   type-safe `get/add` without string keys or classes.
 * - Destruction is deferred until `flush()` so systems can safely destroy
 *   entities while iterating a query.
 */

export type Entity = number;

export interface ComponentType<T> {
  readonly id: number;
  readonly name: string;
  /** Phantom field: carries T for inference only. */
  readonly __type?: T;
}

let nextComponentId = 0;

export function defineComponent<T>(name: string): ComponentType<T> {
  return { id: nextComponentId++, name };
}

export class World {
  private nextEntity: Entity = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<number, Map<Entity, unknown>>();
  private readonly pendingDestroy = new Set<Entity>();
  private readonly resources = new Map<ComponentType<unknown>, unknown>();

  create(): Entity {
    const e = this.nextEntity++;
    this.alive.add(e);
    return e;
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e) && !this.pendingDestroy.has(e);
  }

  /** Marks an entity for removal at the next `flush()`. */
  destroy(e: Entity): void {
    if (this.alive.has(e)) this.pendingDestroy.add(e);
  }

  flush(): Entity[] {
    if (this.pendingDestroy.size === 0) return [];
    const removed = [...this.pendingDestroy];
    for (const e of removed) {
      for (const store of this.stores.values()) store.delete(e);
      this.alive.delete(e);
    }
    this.pendingDestroy.clear();
    return removed;
  }

  add<T>(e: Entity, type: ComponentType<T>, data: T): T {
    this.store(type).set(e, data);
    return data;
  }

  remove<T>(e: Entity, type: ComponentType<T>): void {
    this.store(type).delete(e);
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.store(type).get(e);
  }

  /** Like `get`, but throws if the component is missing. */
  req<T>(e: Entity, type: ComponentType<T>): T {
    const c = this.store(type).get(e);
    if (c === undefined) throw new Error(`Entity ${e} has no component ${type.name}`);
    return c;
  }

  has(e: Entity, type: ComponentType<unknown>): boolean {
    return this.store(type).has(e);
  }

  /** Returns live entities that own every listed component type. */
  query(...types: ComponentType<unknown>[]): Entity[] {
    if (types.length === 0) return [...this.alive].filter((e) => !this.pendingDestroy.has(e));
    const stores = types.map((t) => this.store(t));
    stores.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = stores;
    const out: Entity[] = [];
    for (const e of smallest.keys()) {
      if (this.pendingDestroy.has(e)) continue;
      if (rest.every((s) => s.has(e))) out.push(e);
    }
    return out;
  }

  /** Global singletons (input state, map data, ...). */
  setResource<T>(type: ComponentType<T>, value: T): void {
    this.resources.set(type, value);
  }

  getResource<T>(type: ComponentType<T>): T {
    const r = this.resources.get(type);
    if (r === undefined) throw new Error(`Missing resource ${type.name}`);
    return r as T;
  }

  private store<T>(type: ComponentType<T>): Map<Entity, T> {
    let s = this.stores.get(type.id);
    if (!s) {
      s = new Map();
      this.stores.set(type.id, s);
    }
    return s as Map<Entity, T>;
  }
}
