// findBy* / waitFor: allow for the first route-tree render (renderRouter) on a slow CI runner.
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });
