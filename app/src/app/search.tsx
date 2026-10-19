import { Redirect, useLocalSearchParams } from 'expo-router';

/** /search is the Search tab, which lives at /add (M-15). Keeps any params (`?tab=people`, `?focus=1`). */
export default function SearchRedirect() {
  const params = useLocalSearchParams<{ tab?: string; focus?: string }>();
  return <Redirect href={{ pathname: '/add', params }} />;
}
