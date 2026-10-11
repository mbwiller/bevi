import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api, mockControls } from '@/api/client';
import AccountScreen from '@/app/settings/account';
import DeleteAccountScreen from '@/app/settings/delete-account';
import SettingsIndexScreen from '@/app/settings/index';
import PrivacyScreen from '@/app/settings/privacy';
import { useSession } from '@/state/session';

import { parseMarkdown } from '../Markdown';

const controls = mockControls!;
let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function open(url: string) {
  const result = renderRouter(
    {
      _layout: Layout,
      'settings/index': SettingsIndexScreen,
      'settings/account': AccountScreen,
      'settings/privacy': PrivacyScreen,
      'settings/delete-account': DeleteAccountScreen,
      'dev/gallery': Stub,
      'dev/tokens': Stub,
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('demo');
  useSession.setState({ status: 'ready', checked: true, devForced: true });
});

afterEach(() => client.clear());

it('lists the rows, with dev links on the mock', async () => {
  const r = await open('/settings');
  expect(await screen.findByLabelText('Account')).toBeTruthy();
  expect(screen.getByLabelText('Privacy')).toBeTruthy();
  expect(screen.getByLabelText('Delete account')).toBeTruthy();
  expect(screen.getByLabelText('Component gallery')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Account'));
  expect(r.path()).toBe('/settings/account');
});

it('sign out ends the session and the store goes signedOut', async () => {
  await open('/settings');
  await fireEvent.press(await screen.findByLabelText('Sign out'));
  await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
  expect(await api.getSession()).toBeNull();
});

it('delete account needs DELETE typed out', async () => {
  const me = await api.profile.getMe();
  await open('/settings/delete-account');
  const button = await screen.findByRole('button', { name: 'Delete account' });
  expect(button).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'delete');
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
  await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
  expect(await api.getSession()).toBeNull();
  await expect(api.signIn({ username: me.handle, password: 'demo1234' })).rejects.toMatchObject({ code: 'unauthorized' });
});

it('account shows the username and birthdate read-only and saves the display name', async () => {
  const me = await api.profile.getMe();
  await open('/settings/account');
  const username = await screen.findByLabelText('Username');
  expect(username.props.editable).toBe(false);
  expect(username.props.value).toBe(me.handle);
  expect(screen.getByLabelText('Birthdate').props.editable).toBe(false);
  expect(screen.getByText("This can't be changed. Contact us to correct it.")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'New Name');
  await fireEvent.press(screen.getByLabelText('Save name'));
  expect(await screen.findByText('Saved')).toBeTruthy();
  expect((await api.profile.getMe()).displayName).toBe('New Name');
});

it('privacy renders the markdown note', async () => {
  const md = '# Privacy\n\n**Draft.** Intro.\n\n## What we store\n\n- One\n- Two';
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => md }));
  const saved = global.fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  try {
    await open('/settings/privacy');
    expect(await screen.findByText('What we store')).toBeTruthy();
    expect(screen.getByText('Two')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/privacy.md');
  } finally {
    global.fetch = saved;
  }
});

it('parseMarkdown handles headings, lists and paragraphs', () => {
  expect(parseMarkdown('# A\n\nline one\nline two\n\n- x\n- y\n\n## B')).toEqual([
    { kind: 'h1', text: 'A' },
    { kind: 'p', text: 'line one line two' },
    { kind: 'list', items: ['x', 'y'] },
    { kind: 'h2', text: 'B' },
  ]);
});
