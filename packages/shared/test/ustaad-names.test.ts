/**
 * Reserved and confusable display names (spec 23 § 14a SR-4, AT-NAME-1; plan task B3). `nameSkeleton()` folds a name
 * the way UTS #39 "skeleton" does for the scripts members use (NFKC, case fold, look-alike map, marks and separators
 * stripped); two names with the same skeleton look the same to a reader. `displayNameRefusal()` adds the display-name
 * rules (no phone numbers, links or handles in a name).
 */
import { describe, expect, it } from 'vitest';
import { displayNameRefusal, isReservedName, nameSkeleton, RESERVED_NAME_SEED } from '../src/ustaad/names';

const reserved = new Set(RESERVED_NAME_SEED.map((n) => nameSkeleton(n)));

describe('nameSkeleton (TR39-style, SR-4)', () => {
  it('AT-NAME-1: "MechDøst", "Mech Dost", Cyrillic and Greek look-alikes all match "MechDost"', () => {
    const target = nameSkeleton('MechDost');
    for (const n of [
      'MechDøst',
      'Mech Dost',
      'mech-dost',
      'M.e.c.h D.o.s.t',
      'MЕchDоst', // Cyrillic Е and о
      'Месh Dоst', // Cyrillic М, е, с, о
      'MECHDOST',
      'Ｍｅｃｈ Ｄｏｓｔ', // full-width (NFKC)
      'Mech​Dost', // zero-width space
      'Mêch Döst', // accents
      'Mech D0st', // digit zero
    ])
      expect(nameSkeleton(n), n).toBe(target);
  });

  it('keeps different names different', () => {
    expect(nameSkeleton('Ramesh Kumar')).not.toBe(nameSkeleton('Suresh Kumar'));
    expect(nameSkeleton('Raju')).not.toBe(nameSkeleton('MechDost'));
  });

  it('folds Devanagari nukta and joiners so "मेकदोस्त" variants match', () => {
    expect(nameSkeleton('मेक दोस्त')).toBe(nameSkeleton('मेकदोस्त'));
    expect(nameSkeleton('मेक‍दोस्त')).toBe(nameSkeleton('मेकदोस्त'));
    expect(nameSkeleton('ज़')).toBe(nameSkeleton('ज'));
  });

  it('is stable (the seed migration stores these exact skeletons)', () => {
    expect(nameSkeleton('MechDost')).toBe('mechdost');
    expect(nameSkeleton('Ustaad Official')).toBe('ustaadofficial');
  });
});

describe('isReservedName', () => {
  it('refuses a reserved word inside a longer name, and look-alikes of it', () => {
    expect(isReservedName('MechDost', reserved)).toBe(true);
    expect(isReservedName('MechDøst Support', reserved)).toBe(true);
    expect(isReservedName('Official Mech Dost Team', reserved)).toBe(true);
    expect(isReservedName('Admin', reserved)).toBe(true);
    expect(isReservedName('मेकदोस्त', reserved)).toBe(true);
  });

  it('allows ordinary names, including ones that merely contain short reserved letters', () => {
    expect(isReservedName('Ramesh Kumar', reserved)).toBe(false);
    expect(isReservedName('Badmin Singh', reserved)).toBe(false); // "admin" inside a longer word
    expect(isReservedName('Raju Motors', reserved)).toBe(false);
    expect(isReservedName('रमेश', reserved)).toBe(false);
  });
});

describe('displayNameRefusal', () => {
  it('refuses phone numbers, links, handles and emails in a name', () => {
    expect(displayNameRefusal('Raju 9876543210')).toBe('NAME_CONTACT');
    expect(displayNameRefusal('Raju ९८७६५४३२१०')).toBe('NAME_CONTACT');
    expect(displayNameRefusal('Raju www.raju.in')).toBe('NAME_CONTACT');
    expect(displayNameRefusal('Raju @raju')).toBe('NAME_CONTACT');
    expect(displayNameRefusal('raju@mail.com')).toBe('NAME_CONTACT');
  });

  it('refuses names without letters and invisible control characters', () => {
    expect(displayNameRefusal('1234')).toBe('NAME_FORMAT');
    expect(displayNameRefusal('---')).toBe('NAME_FORMAT');
    expect(displayNameRefusal('Raju‮')).toBe('NAME_FORMAT');
  });

  it('allows Latin and Devanagari names with a garage number', () => {
    expect(displayNameRefusal('Raju Mistri')).toBeNull();
    expect(displayNameRefusal('रमेश भाई')).toBeNull();
    expect(displayNameRefusal("D'Souza Auto 2")).toBeNull();
  });
});
