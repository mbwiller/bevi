import { runConformance } from '../../conformance';
import { MOCK_INVITE_CODE, MockApi } from '../MockApi';
import { MOCK_ALCOHOLIC_BEV_ID } from '../seed/extra';

runConformance(() => new MockApi({ storage: null, latency: 0 }), {
  inviteCode: MOCK_INVITE_CODE,
  alcoholicBevId: MOCK_ALCOHOLIC_BEV_ID,
});
