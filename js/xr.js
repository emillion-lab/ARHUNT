// xr.js — договаряне на WebXR сесия.
//
// Уроци от диагностиката: минималният набор (hit-test + dom-overlay върху
// document.body) работи безотказно. Всичко отгоре е по избор и се включва
// изрично, защото всяка добавена функция променя пътя на композиране в
// Chrome и може да счупи целия кадър.

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

// wanted: { anchors, planes, depth, light } — всичко по подразбиране false
export async function startSession(overlayRoot, wanted = {}) {
  const optional = ['dom-overlay'];
  if (wanted.anchors) optional.push('anchors');
  if (wanted.planes) optional.push('plane-detection');
  if (wanted.depth) optional.push('depth-sensing');
  if (wanted.light) optional.push('light-estimation');

  const init = {
    requiredFeatures: ['hit-test'],
    optionalFeatures: optional,
    domOverlay: { root: overlayRoot }
  };

  if (wanted.depth) {
    init.depthSensing = {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32']
    };
  }

  try {
    const session = await navigator.xr.requestSession('immersive-ar', init);
    return { session, degraded: false };
  } catch (err) {
    console.warn('[xr] пълната сесия е отказана, отстъпвам:', err.message);
  }

  // Гола сесия: точно каквото тестовата страница доказа, че работи.
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlayRoot }
  });
  return { session, degraded: true };
}

// Кои функции реално са активни в дадена сесия.
export function describeSession(session) {
  const enabled = Array.from(session.enabledFeatures || []);
  const has = (f) => enabled.includes(f);
  return {
    list: enabled,
    anchors: has('anchors'),
    planes: has('plane-detection'),
    depth: has('depth-sensing') && session.depthUsage === 'cpu-optimized',
    light: has('light-estimation')
  };
}
