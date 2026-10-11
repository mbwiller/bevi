import { useLocalSearchParams } from 'expo-router';

import { CreateBevWizard } from '@/features/create-bev/CreateBevWizard';

/** Create a new Bev (DEVELOPMENT-MATT §6.10), full-screen modal. `?name=` prefills the name from search. */
export default function NewBevScreen() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  return <CreateBevWizard initialName={typeof name === 'string' ? name : ''} />;
}
