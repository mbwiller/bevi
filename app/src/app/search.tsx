import { Redirect, useLocalSearchParams } from 'expo-router';

/** /search is the Add Bev tab, which lives at /add (M-15, M-32). Keeps any params (`?focus=1`). */
export default function SearchRedirect() {
  const params = useLocalSearchParams<{ tab?: string; focus?: string }>();
  return <Redirect href={{ pathname: '/add', params }} />;
}
