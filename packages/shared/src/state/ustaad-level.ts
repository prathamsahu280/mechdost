import { USTAAD_LEVELS, type UstaadLevel } from '../ustaad/codes';
import { defineMachine } from './machine';

/**
 * Ustaad levels (spec 23 § 7.3, § 9.2). Up only by the level engine (`system`) or staff; Bada and Master only by staff
 * (locked staff review, SR-8, AT-LEVEL-2); down only by a staff `level_review` (four-eyes in the repository); never
 * for inactivity. No terminal state: a demoted member can climb again.
 */
export const ustaadLevelMachine = /* @__PURE__ */ defineMachine<UstaadLevel>(
  'ustaad_level',
  USTAAD_LEVELS,
  [],
  [
    { from: 'apprentice', to: 'naya', by: ['system', 'admin'] },
    { from: 'ustaad_pending', to: 'naya', by: ['admin'] },
    { from: 'naya', to: 'pakka', by: ['system', 'admin'] },
    { from: 'pakka', to: 'bada', by: ['admin'] },
    { from: 'bada', to: 'master', by: ['admin'] },
    { from: 'master', to: 'bada', by: ['admin'] },
    { from: 'bada', to: 'pakka', by: ['admin'] },
    { from: 'pakka', to: 'naya', by: ['admin'] },
  ],
);
