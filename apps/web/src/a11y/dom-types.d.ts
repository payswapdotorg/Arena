/* eslint-disable no-var -- ambient global declarations require `declare var`;
   this file is type-only and never emitted. */

/**
 * B018 a11y/responsive layer — minimal ambient DOM type surface.
 *
 * Arena's apps/web deliberately compiles WITHOUT the DOM lib (server-first
 * composition posture: every existing screen renders through
 * `react-dom/server` `renderToStaticMarkup`). The B018 interactive
 * primitives (focus trap, skip navigation, media-query hooks, touch
 * gestures) target a browser runtime and never execute under the
 * composition checks. These structural declarations keep that layer
 * type-checkable without adding the full DOM lib to `tsconfig.json` —
 * which would change `BufferSource` resolution for transitively
 * type-checked workspace sources (packages export their source, e.g.
 * `@arena/protocol-core`).
 *
 * The surface is intentionally minimal — only what the B018 layer
 * references. Function members use method syntax (bivariant parameters)
 * so browser-runtime handlers type-check against these shapes.
 */

interface Event {
  readonly type: string;
  preventDefault(): void;
}

interface Attr {
  readonly name: string;
  readonly value: string;
}

interface KeyboardEvent extends Event {
  key: string;
  shiftKey: boolean;
}

interface DOMRect {
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

interface Element {
  tagName: string;
  id: string;
  className: string;
  textContent: string | null;
  innerHTML: string;
  attributes: Attr[];
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  getBoundingClientRect(): DOMRect;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): NodeListOf<Element>;
  addEventListener<K extends string>(type: K, listener: (event: K extends 'keydown' ? KeyboardEvent : Event) => void, options?: { once?: boolean; passive?: boolean }): void;
  removeEventListener<K extends string>(type: K, listener: (event: K extends 'keydown' ? KeyboardEvent : Event) => void): void;
  dispatchEvent(event: Event): boolean;
}

interface HTMLElement extends Element {
  focus(): void;
  blur(): void;
  isContentEditable: boolean;
  readonly offsetHeight: number;
  readonly offsetWidth: number;
  style: Partial<Record<string, string>>;
  textContent: string | null;
}

interface NodeListOf<TNode> {
  readonly length: number;
  item(index: number): TNode | null;
  forEach(callback: (value: TNode, index: number, list: NodeListOf<TNode>) => void): void;
  [index: number]: TNode;
}

interface CSSStyleDeclaration {
  readonly color: string;
  readonly backgroundColor: string;
  [property: string]: string;
}

interface MediaQueryList {
  readonly matches: boolean;
  readonly media: string;
  addEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void;
}

interface MediaQueryListEvent extends Event {
  readonly matches: boolean;
  readonly media: string;
}

interface Navigator {
  readonly maxTouchPoints: number;
  readonly msMaxTouchPoints?: number;
  readonly userAgent: string;
}

interface Window {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly pageYOffset: number;
  readonly navigator: Navigator;
  matchMedia(query: string): MediaQueryList;
  getComputedStyle(element: Element): CSSStyleDeclaration;
  scrollTo(x: number, y: number): void;
  scrollTo(options?: { top?: number; left?: number; behavior?: string }): void;
  addEventListener(type: string, listener: (event: Event) => void, options?: { once?: boolean; passive?: boolean }): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
  defineProperty(obj: object, prop: string, descriptor: object): object;
}

interface Document {
  readonly activeElement: HTMLElement | null;
  readonly documentElement: HTMLElement;
  readonly body: HTMLElement;
  getElementById(elementId: string): HTMLElement | null;
  createElement(tagName: string): HTMLElement;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): NodeListOf<Element>;
  addEventListener<K extends string>(type: K, listener: (event: K extends 'keydown' ? KeyboardEvent : Event) => void, options?: { once?: boolean; passive?: boolean }): void;
  removeEventListener<K extends string>(type: K, listener: (event: K extends 'keydown' ? KeyboardEvent : Event) => void): void;
}

declare var window: Window;
declare var document: Document;
declare var navigator: Navigator;
