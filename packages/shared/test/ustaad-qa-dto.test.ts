import { describe, expect, it } from 'vitest';
import {
  AnswerDto,
  AnswerPartsDto,
  AskQuestionDto,
  LearnProgressDto,
  USTAAD_QUESTION_CODE_RE,
} from '../src/ustaad/dto/qa';
import { ustaadPublicCode } from '../src/ustaad/public-code';

describe('ustaad Q&A DTOs', () => {
  it('a question needs a title or a voice note; unknown fields (status, askerId) are refused', () => {
    expect(AskQuestionDto.safeParse({ idemKey: 'abcdefgh' }).success).toBe(false);
    expect(AskQuestionDto.safeParse({ title: 'Brake', idemKey: 'abcdefgh' }).success).toBe(true);
    expect(
      AskQuestionDto.safeParse({ voiceMediaId: '00000000-0000-7000-8000-000000000000', idemKey: 'abcdefgh' })
        .success,
    ).toBe(true);
    expect(AskQuestionDto.safeParse({ title: 'Brake', status: 'solved', idemKey: 'abcdefgh' }).success).toBe(
      false,
    );
  });

  it('an answer needs a body or a voice note; Devanagari digits are kept as typed', () => {
    expect(AnswerDto.safeParse({ idemKey: 'abcdefgh' }).success).toBe(false);
    const r = AnswerDto.parse({ body: 'प्लग ६३०१ बदलो', idemKey: 'abcdefgh' });
    expect(r.body).toBe('प्लग ६३०१ बदलो');
  });

  it('parts: at most 5, no duplicates', () => {
    const id = '00000000-0000-7000-8000-000000000000';
    expect(AnswerPartsDto.safeParse({ productIds: [id, id] }).success).toBe(false);
    expect(AnswerPartsDto.safeParse({ productIds: Array(6).fill(id) }).success).toBe(false);
  });

  it('progress: watched seconds or a self mark, not both', () => {
    expect(LearnProgressDto.safeParse({ deltaSeconds: 10, selfMark: true }).success).toBe(false);
    expect(LearnProgressDto.safeParse({}).success).toBe(false);
    expect(LearnProgressDto.safeParse({ selfMark: true }).success).toBe(true);
    expect(LearnProgressDto.safeParse({ deltaSeconds: 301 }).success).toBe(false);
  });
});

describe('ustaadPublicCode', () => {
  it('matches the DB CHECK (RFC 4648 base32) every time', () => {
    for (let i = 0; i < 200; i += 1) expect(ustaadPublicCode('UQ', 'RPR')).toMatch(USTAAD_QUESTION_CODE_RE);
    expect(() => ustaadPublicCode('UQ', 'rp')).toThrow(RangeError);
  });
});
