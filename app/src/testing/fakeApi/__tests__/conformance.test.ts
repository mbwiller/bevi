import { runConformance } from '@bevi/conformance';
import { FakeApi } from '../FakeApi';
import { ALCOHOLIC_BEV_ID, FAKE_INVITE_CODE } from '../people';

runConformance(() => new FakeApi({ storage: null, latency: 0, photoProcessingMs: 0 }), {
  inviteCode: FAKE_INVITE_CODE,
  alcoholicBevId: ALCOHOLIC_BEV_ID,
  makeInternalReporter: (api) => (api as FakeApi).setInternalReporter(true),
  makeTesterReporter: (api) => (api as FakeApi).setTesterReporter(),
  setBugTicketState: (api, ticketId, state) => (api as FakeApi).setBugTicketState(ticketId, state),
});
