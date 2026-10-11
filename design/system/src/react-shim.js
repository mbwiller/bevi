// The bundle reads React from the page (window.React), never bundling its own copy.
const R = window.React;
export default R;
export const { createElement, Fragment, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useId } = R;
