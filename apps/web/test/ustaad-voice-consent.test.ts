import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { correctionModeChoices, voiceConsentFrom } from '../src/lib/ustaad/voice-consent';

const choices = (voice: boolean) => ({
  ok: true as const,
  data: {
    dmMode: 'request' as const,
    suggestMe: true,
    correctionMode: null,
    canChangeCorrection: true,
    dataSaver: true,
    consents: {
      ustaad_profile: true,
      ustaad_directory: false,
      ustaad_training: false,
      ustaad_offers: false,
      ustaad_voice: voice,
      ustaad_correction: false,
    },
    version: 3,
  },
});

describe('voice consent before the first recording (SIM-P10)', () => {
  it('asks when the member has not allowed voice notes; never asks again once allowed', () => {
    expect(voiceConsentFrom(choices(false))).toEqual({ ask: true, version: 3 });
    expect(voiceConsentFrom(choices(true))).toEqual({ ask: false, version: 3 });
  });
  it('when choices cannot be read the recorder still opens (the API refuses an upload without consent)', () => {
    expect(voiceConsentFrom({ ok: false, status: 0, code: 'NETWORK' })).toEqual({
      ask: false,
      version: null,
    });
  });
  it('G17: "Fix by itself" is offered with suggest and off only where the admin lets members choose', () => {
    expect(correctionModeChoices(true)).toEqual(['suggest', 'auto', 'off']);
    expect(correctionModeChoices(false)).toEqual([]);
  });
  it('the consent prompt and choices strings exist in English and Hindi', () => {
    const keys = [
      'voiceConsentH',
      'voiceConsentBody',
      'voiceConsentAllow',
      'voiceConsentNotNow',
      'choicesH',
      'correctionH',
      'correction_suggest',
      'correction_auto',
      'correction_off',
      'consentVoice',
      'consentCorrection',
      'choicesSaved',
    ];
    for (const dict of [en, hi]) {
      const ns = (dict.ustaad as unknown as Record<string, Record<string, string>>).media ?? {};
      for (const k of keys) expect(ns[k], k).toBeTruthy();
    }
  });
});
