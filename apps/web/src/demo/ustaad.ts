import type { ChoicesView, MemberView } from '@mechdost/shared/ustaad/dto/members';
import type { AnswerView, LearnView, QuestionCard, QuestionDetail } from '@mechdost/shared/ustaad/dto/qa';
import type { ApiResult } from '@/lib/orders-api';
import type { ApplicantView, Job, MyLocation, UstaadClient, Zone } from '@/lib/ustaad/client';

/**
 * Sample data for the Ustaad C + E screens in the browser demo (the staff preview with no API; spec 23 § 5). Every
 * screen that uses it shows the "Sample data" note. Kept in memory only (a reload starts again), never on the device,
 * so nothing a member types is stored anywhere (decision 2026-11-14, browser-only features). Names, questions, answers
 * and job texts are user-written content (shown as typed); titles of lessons carry English and Hindi.
 */

const ok = <T>(data: T): Promise<ApiResult<T>> => Promise.resolve({ ok: true, data });
const fail = <T>(status: number, code: string): Promise<ApiResult<T>> =>
  Promise.resolve({ ok: false, status, code });

const NOW = Date.UTC(2026, 10, 26, 6, 30);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const author = (
  id: string,
  handle: string,
  displayName: string,
  displayNameHi: string | null,
  level: string,
  track: 'apprentice' | 'ustaad' = 'ustaad',
) => ({ id, handle, displayName, displayNameHi, level, track });

const ME = author('0193a000-0000-7000-8000-000000000001', 'ramesh_rpr', 'Ramesh Sahu', 'रमेश साहू', 'pakka');
const SURESH = author(
  '0193a000-0000-7000-8000-000000000002',
  'suresh_auto',
  'Suresh Verma',
  'सुरेश वर्मा',
  'bada',
);
const IMRAN = author(
  '0193a000-0000-7000-8000-000000000003',
  'imran_ev',
  'Imran Khan',
  'इमरान ख़ान',
  'master',
);
const SONU = author(
  '0193a000-0000-7000-8000-000000000004',
  'sonu_learns',
  'Sonu Yadav',
  'सोनू यादव',
  'apprentice',
  'apprentice',
);
const DEEPAK = author(
  '0193a000-0000-7000-8000-000000000005',
  'deepak_ac',
  'Deepak Patel',
  'दीपक पटेल',
  'naya',
);

const MEMBER: MemberView = {
  id: ME.id,
  handle: ME.handle,
  displayName: ME.displayName,
  displayNameHi: ME.displayNameHi,
  track: 'ustaad',
  level: 'pakka',
  status: 'active',
  verificationState: 'verified',
  cityCode: 'RPR',
  areaLabel: 'Telibandha',
  areaLabelHi: 'तेलीबांधा',
  workPlace: 'shop',
  garageName: null,
  showGarage: false,
  yearsClaimed: 9,
  specialities: ['two_wheeler', 'engine', 'electrical'],
  dmMode: 'request',
  suggestMe: true,
  lang: 'hi',
  official: false,
  founding: true,
  restrictedMode: 'none',
  joinedAt: ago(60 * 24 * 40),
  version: 3,
};

const answer = (
  id: string,
  a: typeof ME,
  body: string | null,
  helpful: number,
  minutes: number,
  extra: Partial<AnswerView> = {},
): AnswerView => ({
  id,
  body,
  bodyOriginal: null,
  correction: 'none',
  voiceMediaId: null,
  helpfulCount: helpful,
  votedByMe: false,
  isBest: false,
  mine: a.id === ME.id,
  author: a,
  parts: [],
  createdAt: ago(minutes),
  ...extra,
});

function detail(card: QuestionCard, rest: Partial<QuestionDetail>): QuestionDetail {
  return {
    ...card,
    body: null,
    bodyOriginal: null,
    correction: 'none',
    voiceMediaId: null,
    bestAnswerId: null,
    vehicleModel: null,
    can: { answer: !card.mine, chooseBest: card.mine && card.status !== 'solved' },
    answerList: [],
    ...rest,
  };
}

function seedQuestions(): QuestionDetail[] {
  const q1: QuestionCard = {
    code: 'UQ-RPR-2026-K7QM2D',
    title: 'Splendor Plus self start nahi ho raha, battery nayi hai',
    hasVoice: true,
    segmentCode: 'two_wheeler',
    workCode: 'electrical',
    safetyTag: null,
    status: 'solved',
    answers: 3,
    asker: SONU,
    mine: false,
    createdAt: ago(190),
  };
  const best = answer(
    '0193a100-0000-7000-8000-000000000011',
    SURESH,
    'Pehle starter relay check karo. Click ki awaaz aaye aur motor na ghoome to relay ya carbon brush. Brake lever switch bhi dekh lo, Splendor mein brake dabaye bina self nahi lagta.',
    14,
    170,
    {
      isBest: true,
      parts: [
        {
          productId: '0193a200-0000-7000-8000-000000000021',
          slug: 'exide-xltz4a-2w-battery',
          name: 'Exide XLTZ4A battery',
          nameHi: 'Exide XLTZ4A बैटरी',
        },
      ],
    },
  );
  const q2: QuestionCard = {
    code: 'UQ-RPR-2026-B3XN7P',
    title: 'Activa 6G pickup kam, accelerator dene pe jhatka',
    hasVoice: false,
    segmentCode: 'two_wheeler',
    workCode: 'engine',
    safetyTag: null,
    status: 'answered',
    answers: 2,
    asker: DEEPAK,
    mine: false,
    createdAt: ago(75),
  };
  const q3: QuestionCard = {
    code: 'UQ-RPR-2026-T5WQ3L',
    title: 'Swift ka brake pedal neeche tak ja raha hai',
    hasVoice: false,
    segmentCode: 'car_suv',
    workCode: 'suspension_brakes',
    safetyTag: 'brake',
    status: 'open',
    answers: 0,
    asker: SONU,
    mine: false,
    createdAt: ago(22),
  };
  const q4: QuestionCard = {
    code: 'UQ-RPR-2026-H2RV6S',
    title: null,
    hasVoice: true,
    segmentCode: 'three_wheeler',
    workCode: null,
    safetyTag: 'ev_hv',
    status: 'open',
    answers: 0,
    asker: ME,
    mine: true,
    createdAt: ago(8),
  };
  const q5: QuestionCard = {
    code: 'UQ-RPR-2026-M4ZC5J',
    title: 'Bolero AC thanda nahi kar raha, gas bhari hai',
    hasVoice: false,
    segmentCode: 'car_suv',
    workCode: 'ac',
    safetyTag: null,
    status: 'answered',
    answers: 1,
    asker: ME,
    mine: true,
    createdAt: ago(60 * 26),
  };
  return [
    detail(q4, { voiceMediaId: '0193a300-0000-7000-8000-000000000031' }),
    detail(q3, {
      body: 'Brake oil bhara hai, leak nahi dikh raha. Pedal do teen baar dabane pe upar aata hai.',
      vehicleModel: 'Maruti Suzuki Swift VXi',
    }),
    detail(q2, {
      body: 'Plug saaf kiya, air filter naya. Thanda hone pe theek chalti hai.',
      answerList: [
        answer(
          '0193a100-0000-7000-8000-000000000012',
          IMRAN,
          'Throttle body saaf karo aur TPS ki reading dekho. 6G mein injector jaam hona aam hai.',
          6,
          60,
        ),
        answer(
          '0193a100-0000-7000-8000-000000000013',
          ME,
          'Fuel pump ka pressure bhi check kar lena.',
          2,
          40,
          {
            mine: true,
          },
        ),
      ],
    }),
    detail(q1, {
      body: 'Click ki awaaz aati hai bas. Fuse theek hai.',
      voiceMediaId: '0193a300-0000-7000-8000-000000000032',
      bestAnswerId: best.id,
      vehicleModel: 'Hero Splendor Plus',
      can: { answer: true, chooseBest: false },
      answerList: [
        best,
        answer(
          '0193a100-0000-7000-8000-000000000014',
          DEEPAK,
          'Earthing wire dekho, engine se frame tak.',
          3,
          150,
          {
            bodyOriginal: 'erthing wayar dekho engin se frem tak',
            body: 'Earthing wire dekho, engine se frame tak.',
            correction: 'suggested_used',
          },
        ),
        answer('0193a100-0000-7000-8000-000000000015', IMRAN, null, 1, 140, {
          voiceMediaId: '0193a300-0000-7000-8000-000000000033',
        }),
      ],
    }),
    detail(q5, {
      body: 'Compressor chal raha hai, cooling coil pe barf jam rahi hai.',
      answerList: [
        answer(
          '0193a100-0000-7000-8000-000000000016',
          SURESH,
          'Expansion valve choke hai. Coil pe barf matlab flow ruk raha hai.',
          4,
          60 * 20,
        ),
      ],
    }),
  ];
}

const LEARN: LearnView = {
  courses: [
    {
      id: '0193a400-0000-7000-8000-000000000041',
      code: 'how_to_use',
      titleEn: 'How to use Mechanic Network',
      titleHi: 'मैकेनिक नेटवर्क कैसे चलाएँ',
      resources: [
        {
          id: '0193a500-0000-7000-8000-000000000051',
          kind: 'hosted_video',
          titleEn: 'Ask a question by voice',
          titleHi: 'बोलकर सवाल पूछो',
          segmentCode: null,
          workCode: null,
          durationS: 75,
          mediaId: '0193a300-0000-7000-8000-000000000034',
          url: null,
          label: 'mechdost_training',
          watchedSeconds: 75,
          completed: true,
        },
        {
          id: '0193a500-0000-7000-8000-000000000052',
          kind: 'hosted_video',
          titleEn: 'Pin your garage on the map',
          titleHi: 'अपना गैराज नक्शे पर लगाओ',
          segmentCode: null,
          workCode: null,
          durationS: 60,
          mediaId: '0193a300-0000-7000-8000-000000000035',
          url: null,
          label: 'mechdost_training',
          watchedSeconds: 20,
          completed: false,
        },
        {
          id: '0193a500-0000-7000-8000-000000000053',
          kind: 'hosted_video',
          titleEn: 'Earn Izzat with good answers',
          titleHi: 'अच्छे जवाबों से इज़्ज़त कमाओ',
          segmentCode: null,
          workCode: null,
          durationS: 90,
          mediaId: '0193a300-0000-7000-8000-000000000036',
          url: null,
          label: 'mechdost_training',
          watchedSeconds: 0,
          completed: false,
        },
      ],
    },
    {
      id: '0193a400-0000-7000-8000-000000000042',
      code: 'bs6_fi_basics',
      titleEn: 'BS6 fuel injection basics',
      titleHi: 'BS6 फ़्यूल इंजेक्शन की बुनियादी बातें',
      resources: [
        {
          id: '0193a500-0000-7000-8000-000000000054',
          kind: 'hosted_video',
          titleEn: 'Reading the fault light',
          titleHi: 'खराबी वाली बत्ती पढ़ना',
          segmentCode: 'two_wheeler',
          workCode: 'diagnostics',
          durationS: 420,
          mediaId: '0193a300-0000-7000-8000-000000000037',
          url: null,
          label: 'mechdost_training',
          watchedSeconds: 0,
          completed: false,
        },
        {
          id: '0193a500-0000-7000-8000-000000000055',
          kind: 'hosted_video',
          titleEn: 'Cleaning a throttle body',
          titleHi: 'थ्रॉटल बॉडी की सफ़ाई',
          segmentCode: 'two_wheeler',
          workCode: 'engine',
          durationS: 300,
          mediaId: '0193a300-0000-7000-8000-000000000038',
          url: null,
          label: 'none',
          watchedSeconds: 0,
          completed: false,
        },
      ],
    },
  ],
  loose: [
    {
      id: '0193a500-0000-7000-8000-000000000056',
      kind: 'external_link',
      titleEn: 'EV battery safety checklist',
      titleHi: 'EV बैटरी सुरक्षा की जाँच-सूची',
      segmentCode: 'ev',
      workCode: 'battery',
      durationS: 240,
      mediaId: null,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      label: 'none',
      watchedSeconds: 0,
      completed: false,
    },
    {
      id: '0193a500-0000-7000-8000-000000000057',
      kind: 'hosted_video',
      titleEn: 'Tubeless puncture repair in 3 minutes',
      titleHi: 'ट्यूबलेस पंक्चर 3 मिनट में ठीक करो',
      segmentCode: 'two_wheeler',
      workCode: 'tyres',
      durationS: 180,
      mediaId: '0193a300-0000-7000-8000-000000000039',
      url: null,
      label: 'none',
      watchedSeconds: 0,
      completed: false,
    },
  ],
};

const band = (value: number) => ({ kind: 'band' as const, value });
const exact = (value: number) => ({ kind: 'exact' as const, value });
const few = { kind: 'few' as const };
const ZONES: Zone[] = [
  {
    zoneCell: 'z1',
    center: { lat: 21.275, lng: 81.6 },
    total: exact(25),
    segments: { two_wheeler: exact(20), car_suv: band(5) },
  },
  {
    zoneCell: 'z2',
    center: { lat: 21.275, lng: 81.64 },
    total: exact(55),
    segments: { two_wheeler: exact(30), car_suv: exact(20) },
  },
  { zoneCell: 'z3', center: { lat: 21.275, lng: 81.68 }, total: band(5), segments: {} },
  {
    zoneCell: 'z4',
    center: { lat: 21.245, lng: 81.62 },
    total: exact(40),
    segments: { two_wheeler: exact(25), three_wheeler: band(5) },
  },
  { zoneCell: 'z5', center: { lat: 21.245, lng: 81.66 }, total: few, segments: {} },
  { zoneCell: 'z6', center: { lat: 21.215, lng: 81.6 }, total: band(5), segments: {} },
  { zoneCell: 'z7', center: { lat: 21.215, lng: 81.64 }, total: exact(30), segments: { car_suv: exact(20) } },
  { zoneCell: 'z8', center: { lat: 21.215, lng: 81.68 }, total: few, segments: {} },
];

function seedJobs(): Job[] {
  const base = {
    cityCode: 'RPR',
    status: 'open',
    mine: false,
    underReview: false,
    expiresAt: new Date(NOW + 20 * 24 * 3_600_000).toISOString(),
  };
  return [
    {
      ...base,
      code: 'UJ-RPR-2026-Q4MZ7A',
      roleCode: 'mechanic_2w',
      title: 'Bike mechanic chahiye, Hero aur Honda ka kaam',
      description:
        'Roz 20-25 bike aati hain. Service, clutch, carburettor aur FI ka kaam. Rehne ki jagah nahi, khana dopahar ka hamara.',
      areaLabel: 'Shankar Nagar',
      areaLabelHi: 'शंकर नगर',
      payMinPaiseMonth: 1_400_000,
      payMaxPaiseMonth: 1_800_000,
      timing: '9 am - 8 pm, Tuesday off',
      experienceMinYears: 2,
      segmentCodes: ['two_wheeler'],
      createdAt: ago(60 * 5),
    },
    {
      ...base,
      code: 'UJ-RPR-2026-W2KC5D',
      roleCode: 'helper',
      title: 'Helper chahiye, seekhne wala',
      description: 'Naya ladka bhi chalega, kaam sikhayenge. Tools hamare.',
      areaLabel: 'Pandri',
      areaLabelHi: 'पंडरी',
      payMinPaiseMonth: 800_000,
      payMaxPaiseMonth: 1_000_000,
      timing: '10 am - 7 pm',
      experienceMinYears: 0,
      segmentCodes: ['two_wheeler', 'three_wheeler'],
      createdAt: ago(60 * 30),
    },
    {
      ...base,
      code: 'UJ-RPR-2026-R7TN3H',
      roleCode: 'electrician',
      title: 'Car electrician, scanner chalana aata ho',
      description:
        'Maruti, Hyundai, Tata. Wiring aur ECU fault dhoondhna. Bonus har mahine kaam ke hisaab se.',
      areaLabel: 'Tatibandh',
      areaLabelHi: 'टाटीबंध',
      payMinPaiseMonth: 2_000_000,
      payMaxPaiseMonth: 2_600_000,
      timing: '9:30 am - 7:30 pm',
      experienceMinYears: 4,
      segmentCodes: ['car_suv'],
      createdAt: ago(60 * 50),
    },
  ];
}

/** A short silent WAV as a `blob:` URL (the CSP allows `blob:` media, not `data:`), so sample voice notes play. */
export function silentWav(seconds: number): string {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export function demoUstaadClient(): UstaadClient {
  const questions = seedQuestions();
  const jobs = seedJobs();
  let choices: ChoicesView = {
    dmMode: 'request',
    suggestMe: true,
    correctionMode: null,
    canChangeCorrection: true,
    dataSaver: true,
    consents: {
      ustaad_profile: true,
      ustaad_directory: false,
      ustaad_training: false,
      ustaad_offers: false,
      ustaad_voice: false,
      ustaad_correction: false,
    },
    version: 1,
  };
  // Sample applicants on the member's own job (SIM-P18); names are sample data like the rest of this file.
  const applicants: ApplicantView[] = [
    {
      applicationId: '00000000-0000-7000-8000-0000000000a1',
      status: 'applied',
      sharePhone: true,
      voiceIntro: true,
      appliedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      version: 1,
      member: {
        id: '00000000-0000-7000-8000-0000000000b1',
        handle: 'suresh_verma',
        displayName: 'Suresh Verma',
        displayNameHi: 'सुरेश वर्मा',
        level: 'pakka',
        verified: true,
      },
    },
    {
      applicationId: '00000000-0000-7000-8000-0000000000a2',
      status: 'seen',
      sharePhone: false,
      voiceIntro: false,
      appliedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      version: 2,
      member: {
        id: '00000000-0000-7000-8000-0000000000b2',
        handle: 'mahesh_patel',
        displayName: 'Mahesh Patel',
        displayNameHi: 'महेश पटेल',
        level: 'naya',
        verified: false,
      },
    },
  ];
  const learn: LearnView = structuredClone(LEARN);
  let pinned: MyLocation | null = null;
  let silent: string | null = null;
  let seq = 0;
  const nextCode = (prefix: 'UQ' | 'UJ') => {
    seq += 1;
    const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    return `${prefix}-RPR-2026-NEWQ${b32.charAt(seq % 32)}${b32.charAt(Math.floor(seq / 32) % 32)}`;
  };
  const card = (d: QuestionDetail): QuestionCard => ({
    code: d.code,
    title: d.title,
    hasVoice: d.hasVoice,
    segmentCode: d.segmentCode,
    workCode: d.workCode,
    safetyTag: d.safetyTag,
    status: d.status,
    answers: d.answerList.length,
    asker: d.asker,
    mine: d.mine,
    createdAt: d.createdAt,
  });
  const find = (code: string) => questions.find((q) => q.code === code);
  const allResources = () => [...learn.courses.flatMap((c) => c.resources), ...learn.loose];

  return {
    sample: true,
    me: () => ok({ member: MEMBER, staffPreview: true }),
    questions: (filter, cursor) => {
      const list = questions.filter((q) => {
        if (filter === 'mine') return q.mine;
        if (filter === 'unanswered') return q.answerList.length === 0 && !q.mine;
        if (filter === 'for_you')
          return !q.mine && (q.segmentCode === 'two_wheeler' || q.workCode === 'electrical');
        return true;
      });
      const start = cursor ? Number(cursor) : 0;
      const page = list.slice(start, start + 4).map(card);
      return ok({ items: page, nextCursor: start + 4 < list.length ? String(start + 4) : null });
    },
    question: (code) => {
      const q = find(code);
      return q ? ok(structuredClone(q)) : fail(404, 'NOT_FOUND');
    },
    ask: (input) => {
      const code = nextCode('UQ');
      questions.unshift(
        detail(
          {
            code,
            title: input.title ?? null,
            hasVoice: input.voiceMediaId !== undefined,
            segmentCode: input.segmentCode ?? null,
            workCode: input.workCode ?? null,
            safetyTag: input.segmentCode === 'ev' ? 'ev_hv' : (input.safetyTag ?? null),
            status: 'open',
            answers: 0,
            asker: ME,
            mine: true,
            createdAt: new Date().toISOString(),
          },
          {
            body: input.body ?? null,
            bodyOriginal: input.bodyOriginal ?? null,
            voiceMediaId: input.voiceMediaId ?? null,
          },
        ),
      );
      return ok({ code });
    },
    answer: (code, input) => {
      const q = find(code);
      if (!q) return fail(404, 'NOT_FOUND');
      if (!q.can.answer) return fail(403, 'USTAAD_CANNOT_ANSWER');
      const a = answer(crypto.randomUUID(), ME, input.body ?? null, 0, 0, {
        createdAt: new Date().toISOString(),
        voiceMediaId: input.voiceMediaId ?? null,
        bodyOriginal: input.bodyOriginal ?? null,
        correction: input.correction ?? 'none',
      });
      q.answerList.push(a);
      q.answers = q.answerList.length;
      if (q.status === 'open') q.status = 'answered';
      return ok({ id: a.id });
    },
    helpful: (id) => {
      const a = questions.flatMap((q) => q.answerList).find((x) => x.id === id);
      if (!a) return fail(404, 'NOT_FOUND');
      if (a.mine) return fail(422, 'USTAAD_SELF_VOTE');
      if (!a.votedByMe) {
        a.votedByMe = true;
        a.helpfulCount += 1;
      }
      return ok({ helpfulCount: a.helpfulCount, voted: true });
    },
    best: (code, answerId) => {
      const q = find(code);
      if (!q?.can.chooseBest) return fail(404, 'NOT_FOUND');
      if (q.bestAnswerId) return fail(409, 'USTAAD_ALREADY_SOLVED');
      const a = q.answerList.find((x) => x.id === answerId);
      if (!a) return fail(404, 'NOT_FOUND');
      a.isBest = true;
      q.bestAnswerId = a.id;
      q.status = 'solved';
      q.can = { ...q.can, chooseBest: false };
      return ok({ status: 'solved' as const });
    },
    learn: () => ok(structuredClone(learn)),
    progress: (id, body) => {
      const r = allResources().find((x) => x.id === id);
      if (!r) return fail(404, 'NOT_FOUND');
      if (body.selfMark) r.completed = true;
      if (body.deltaSeconds !== undefined) {
        r.watchedSeconds = Math.min(r.durationS ?? 0, r.watchedSeconds + body.deltaSeconds);
        if (r.durationS && r.watchedSeconds >= r.durationS * 0.8) r.completed = true;
      }
      return ok({ watchedSeconds: r.watchedSeconds, completed: r.completed });
    },
    myLocation: () => ok(pinned),
    saveLocation: (input) => {
      pinned = {
        lat: input.lat,
        lng: input.lng,
        accuracyM: Math.round(input.accuracyM),
        source: input.source,
        landmark: input.landmark ?? null,
        useForVerify: input.useForVerify,
        countInZone: input.countInZone,
        shareExact: input.shareExact,
        exactAudience: input.exactAudience ?? 'connections',
        hidden: input.hidden ?? false,
        verified: false,
        confirmedAt: new Date().toISOString(),
      };
      return ok(pinned);
    },
    signboard: () => (pinned ? ok({ ok: true as const }) : fail(422, 'USTAAD_PIN_REQUIRED')),
    zones: () => ok(ZONES),
    jobs: (role, cursor) => {
      const list = jobs.filter((j) => (role ? j.roleCode === role : true) && (j.status === 'open' || j.mine));
      const start = cursor ? Number(cursor) : 0;
      return ok({
        items: list.slice(start, start + 10),
        next: start + 10 < list.length ? String(start + 10) : null,
      });
    },
    job: (code) => {
      const j = jobs.find((x) => x.code === code);
      return j ? ok({ ...j }) : fail(404, 'NOT_FOUND');
    },
    postJob: (input) => {
      if (!input.adultAttested) return fail(422, 'USTAAD_ADULT_ATTESTATION');
      const j: Job = {
        code: nextCode('UJ'),
        roleCode: input.roleCode,
        title: input.title,
        description: input.description,
        areaLabel: input.areaLabel,
        areaLabelHi: input.areaLabelHi ?? null,
        cityCode: 'RPR',
        payMinPaiseMonth: input.payMinPaiseMonth,
        payMaxPaiseMonth: input.payMaxPaiseMonth,
        timing: input.timing,
        experienceMinYears: input.experienceMinYears ?? 0,
        segmentCodes: input.segmentCodes ?? [],
        status: 'open',
        mine: true,
        underReview: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      jobs.unshift(j);
      return ok(j);
    },
    apply: (code) => {
      const j = jobs.find((x) => x.code === code);
      if (!j) return fail(404, 'NOT_FOUND');
      if (j.mine) return fail(422, 'USTAAD_OWN_JOB');
      return ok({ applicationId: crypto.randomUUID(), status: 'applied' });
    },
    moveJob: (code, action) => {
      const j = jobs.find((x) => x.code === code && x.mine);
      if (!j) return fail(404, 'NOT_FOUND');
      j.status = { pause: 'paused', resume: 'open', close: 'closed', fill: 'filled' }[action];
      return ok({ status: j.status });
    },
    // Sample choices: voice notes are asked once in the demo too (SIM-P10).
    choices: () => ok({ ...choices, consents: { ...choices.consents } }),
    saveChoices: (body) => {
      if (body.expectedVersion !== choices.version) return fail(409, 'STALE_MEMBER');
      choices = {
        ...choices,
        ...(body.correctionMode === undefined ? {} : { correctionMode: body.correctionMode }),
        consents: { ...choices.consents, ...body.consents },
        version: choices.version + 1,
      };
      return ok({ ...choices });
    },
    // The demo member is in good standing (sample data); the banned and restricted screens are real-sign-in only.
    standing: () =>
      ok({
        status: 'active' as const,
        restrictedUntil: null,
        bannedUntil: null,
        restrictedMode: 'none',
        items: [],
      }),
    fileAppeal: () => fail(404, 'NOT_FOUND'),
    applicants: (code) => {
      const j = jobs.find((x) => x.code === code && x.mine);
      if (!j) return fail(404, 'NOT_FOUND');
      return ok({ items: applicants.map((a) => ({ ...a })), next: null });
    },
    moveApplication: (id, action) => {
      const a = applicants.find((x) => x.applicationId === id);
      if (!a) return fail(404, 'NOT_FOUND');
      a.status = ({ seen: 'seen', shortlist: 'shortlisted', reject: 'rejected', hire: 'hired' } as const)[
        action
      ];
      a.version += 1;
      return ok({ status: a.status });
    },
    upload: async (_file, _meta, onProgress) => {
      for (const pct of [10, 45, 80, 100]) {
        await new Promise((r) => setTimeout(r, 120));
        onProgress(pct);
      }
      return { ok: true, data: { mediaId: crypto.randomUUID() } };
    },
    mediaUrl: () => ok({ url: (silent ??= silentWav(2)) }),
  };
}
