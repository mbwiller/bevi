import { runConformance } from '../../conformance';
import { FakeApi } from '../FakeApi';
import { ALCOHOLIC_BEV_ID, FAKE_INVITE_CODE } from '../people';

runConformance(() => new FakeApi({ storage: null, latency: 0, photoProcessingMs: 0 }), {
  inviteCode: FAKE_INVITE_CODE,
  alcoholicBevId: ALCOHOLIC_BEV_ID,
});
