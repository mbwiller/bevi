import { FindPeopleScreen } from '@/features/people/FindPeopleScreen';

/**
 * People (TASKS.md M-32): find people (search, suggestions) and the points ranking. It lives in the
 * tabs group so the tab bar stays under it, as the design system's ScreenPeople draws it, but it is
 * not one of the five tabs: the bar marks Feed, where it is opened from (`tabIdFor` in the tabs layout).
 */
export default FindPeopleScreen;
