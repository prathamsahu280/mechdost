/** What the header search panel needs from the server (strings, links, mode). Types only: no code ships with it. */
export interface SearchCopy {
  title: string;
  placeholder: string;
  close: string;
  clear: string;
  popular: string;
  categories: string;
  suggestions: string;
  /** Contains `{count}`, filled in the browser (precompiled messages cannot be formatted there). */
  count: string;
  /** Contains `{query}`. */
  seeAll: string;
  esc: string;
  hint: string;
  kind: Record<'brand' | 'range' | 'category' | 'product', string>;
}

export interface SearchData {
  locale: string;
  /** `''` for English, `'/hi'` for Hindi. */
  prefix: string;
  /** Real data mode asks `GET /v1/search/suggest`; the demo build runs the shared parser over the demo catalogue. */
  api: boolean;
  copy: SearchCopy;
  /** Popular searches: each opens `/shop?q=…`. */
  popular: readonly string[];
  /** Category chips: each opens `/shop?category=…`. */
  categories: readonly { label: string; href: string }[];
  /**
   * "Roadside help" suggestion, shown at the top when the words typed mean a breakdown (spec 22, 2026-11-24). `null`
   * where the city has no roadside, so the palette never points at a dead end.
   */
  roadside: { title: string; body: string; kind: string; href: string } | null;
  /** Every category's name in this language, for the demo suggestions. */
  categoryLabels: Readonly<Record<string, string>>;
}

export interface SearchPanelProps {
  data: SearchData;
  onClose: () => void;
}
