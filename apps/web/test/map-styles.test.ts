import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { labelField, localizeLabels, toHybrid } from '../src/lib/map-styles';

/**
 * Map tile labels are drawn on a canvas, so the e2e Hindi gate cannot read them: this test is their gate
 * (user 2026-11-02: "NH30" and road/place names were English on /hi/workshops).
 */
const OPENFREEMAP_NAME = [
  'case',
  ['has', 'name:nonlatin'],
  ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
  ['coalesce', ['get', 'name_en'], ['get', 'name']],
];

function style(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      {
        id: 'place_city',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        layout: { 'text-field': OPENFREEMAP_NAME, 'text-font': ['Noto Sans Regular'] },
      },
      {
        id: 'highway-name-minor',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        layout: { 'text-field': OPENFREEMAP_NAME },
      },
      {
        id: 'highway-shield',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        layout: { 'text-field': ['to-string', ['get', 'ref']] },
      },
      {
        id: 'legacy-poi',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'poi',
        layout: { 'text-field': '{name:latin}' },
      },
      { id: 'icon-only', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', layout: {} },
    ] as LayerSpecification[],
  };
}

const textField = (s: StyleSpecification, id: string): unknown => {
  const layer = s.layers.find((l) => l.id === id);
  return layer?.type === 'symbol' ? layer.layout?.['text-field'] : undefined;
};

describe('localizeLabels', () => {
  it('prefers name:hi on Hindi pages, falling back to the local name', () => {
    expect(labelField('hi')).toEqual(['coalesce', ['get', 'name:hi'], ['get', 'name']]);
    const hi = localizeLabels(style(), 'hi');
    for (const id of ['place_city', 'highway-name-minor', 'legacy-poi']) {
      expect(textField(hi, id), id).toEqual(['coalesce', ['get', 'name:hi'], ['get', 'name']]);
    }
  });

  it('prefers English names on English pages', () => {
    const en = localizeLabels(style(), 'en');
    expect(textField(en, 'place_city')).toEqual([
      'coalesce',
      ['get', 'name:en'],
      ['get', 'name_en'],
      ['get', 'name'],
    ]);
  });

  it('keeps road refs (NH30 is a code), other layers and properties untouched', () => {
    const input = style();
    const hi = localizeLabels(input, 'hi');
    expect(textField(hi, 'highway-shield')).toEqual(['to-string', ['get', 'ref']]);
    expect(textField(hi, 'icon-only')).toBeUndefined();
    expect(hi.layers.find((l) => l.id === 'place_city')).toMatchObject({
      layout: { 'text-font': ['Noto Sans Regular'] },
    });
    expect(hi.layers.slice(0, 2)).toEqual(input.layers.slice(0, 2));
    expect(hi.glyphs).toBe(input.glyphs);
    // Pure: the fetched style is not mutated.
    expect(textField(input, 'place_city')).toEqual(OPENFREEMAP_NAME);
  });

  it('composes with the hybrid (satellite) transform', () => {
    const hybrid = localizeLabels(
      toHybrid(style(), { tiles: 'https://img/{z}/{x}/{y}', attribution: 'x' }),
      'hi',
    );
    expect(hybrid.layers[0]?.id).toBe('md-satellite');
    expect(textField(hybrid, 'place_city')).toEqual(['coalesce', ['get', 'name:hi'], ['get', 'name']]);
    expect(textField(hybrid, 'highway-shield')).toEqual(['to-string', ['get', 'ref']]);
  });
});
