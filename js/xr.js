// xr.js — договаряне на WebXR сесия с постепенно отстъпление.
// Никоя от "богатите" функции не е задължителна: ако телефонът не я дава,
// играта пада едно ниво надолу, а не гърми.

export const REQUIRED = ['hit-test', 'dom-overlay'];
export const OPTIONAL = [
  'anchors',
  'plane-detection',
  'depth-sensing',
  'light-estimation',
  'local-floor'
];

export async function checkSupport() {
  if (!navigator.xr) return { xr: false, ar: false };
  let ar = false;
  try {
    ar = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (_) {
    ar = false;
  }
  return { xr: true, ar };
}

// Опитва пълния набор, после само задължителното.
export async function startSession(overlayRoot) {
  const rich = {
    requiredFeatures: REQUIRED,
    optionalFeatures: OPTIONAL,
    domOverlay: { root: overlayRoot },
    depthSensing: {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32']
    }
  };

  try {
    const session = await navigator.xr.requestSession('immersive-ar', rich);
    return { session, degraded: false };
  } catch (err) {
    console.warn('[xr] пълната сесия е отказана, отстъпвам:', err.message);
  }

  const plain = {
    requiredFeatures: REQUIRED,
    domOverlay: { root: overlayRoot }
  };
  const session = await navigator.xr.requestSession('immersive-ar', plain);
  return { session, degraded: true };
}

// Кои функции реално са активни в дадена сесия.
export function describeSession(session) {
  const enabled = session.enabledFeatures || [];
  const has = (f) => enabled.includes(f);
  return {
    list: enabled,
    anchors: has('anchors'),
    planes: has('plane-detection'),
    depth: has('depth-sensing') && session.depthUsage === 'cpu-optimized',
    light: has('light-estimation'),
    // enabledFeatures липсва в по-стари Chrome-и — тогава пробваме на сляпо
    unknown: enabled.length === 0
  };
}
