// Capture a screen, a window or a tab as the picture to annotate.
//
// The browser's own screen-sharing call (getDisplayMedia) cannot be driven
// from a headless browser - it opens a picker for a person - so the suite
// stands in for it with a real MediaStream from a painted canvas. Everything
// after the picker is the app's own code: grabbing a frame, stopping the
// share, and loading the frame as a new document.
//
// Every capture then shows the frozen frame to pick the part wanted: drag a
// box round it and that is the picture, Enter keeps the whole frame, Escape
// throws it away. A browser cannot draw over other apps, so this is how a
// rectangle of a screen or window is taken.
//
// It is a desktop feature. No phone browser can capture the screen, so the
// button must not be offered there, nor in a desktop window narrow enough to
// take the phone layout.
const { open, seedPhoto } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

// Replaces getDisplayMedia with a stream of a flat colour. `surface` is what
// the person picked in the browser's dialog; `refuse` is them pressing Cancel.
// `square` paints a second colour at a known place, so a picked area can be
// checked for where it came from and not only for its size.
async function fakeShare(page, { width = 640, height = 360, colour = '#2a8c4a',
                                 surface = 'window', refuse = false, square = null } = {}) {
  await page.evaluate(({ width, height, colour, surface, refuse, square }) => {
    window.__share = { calls: 0, track: null, waits: [] };
    navigator.mediaDevices.getDisplayMedia = async options => {
      window.__share.calls++;
      window.__share.asked = options && options.video;
      if (refuse) throw new DOMException('Permission denied', 'NotAllowedError');
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      const g = cv.getContext('2d');
      const paint = () => {
        g.fillStyle = colour; g.fillRect(0, 0, width, height);
        if (square) { g.fillStyle = square.colour; g.fillRect(square.x, square.y, square.w, square.h); }
      };
      paint();
      // A canvas stream only delivers a frame when the canvas is painted.
      window.__share.painter = setInterval(paint, 30);
      const stream = cv.captureStream(30);
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: surface });
      window.__share.track = track;
      return stream;
    };
    // The countdown before a whole-screen grab, counted rather than waited.
    captureWait = async ms => { window.__share.waits.push(ms); };
  }, { width, height, colour, surface, refuse, square });
}

async function captureState(page) {
  return page.evaluate(() => {
    const g = img && ctx.getImageData(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1).data;
    return {
      calls: window.__share.calls,
      image: img ? [img.naturalWidth, img.naturalHeight] : null,
      pixel: g ? [g[0], g[1], g[2]] : null,
      shapes: shapes.length,
      undoSteps: undoStack.length,
      // The share must end once the frame is taken, or the browser keeps its
      // "sharing this screen" bar up with nothing using it.
      shareEnded: window.__share.track ? window.__share.track.readyState === 'ended' : null,
      waits: window.__share.waits,
      // Without a size Chromium scales the screen down to 1280 wide; the
      // ceiling asked for has to be above any real screen.
      askedWidthMax: window.__share.asked && window.__share.asked.width && window.__share.asked.width.max,
      name: sourceFileName,
      toast: document.getElementById('toast').textContent,
    };
  });
}

// Presses Capture, answers the area picker with `pick`, and waits for the app
// to say it has finished - taken, cancelled or failed - rather than for a
// guessed number of milliseconds. `pick` is 'whole' (Enter), 'cancel'
// (Escape), 'wholeButton' / 'cancelButton' (the picker's own buttons), or
// { from: [x, y], to: [x, y] }, a drag between two points of the frame in its
// own pixels. A picture still decodes after the capture returns, so a capture
// that should bring one also waits for it to be on the canvas.
async function captureAndSettle(page, { pick = 'whole', expectPicture = true, picker = true } = {}) {
  const before = await page.evaluate(() => img ? img.src : null);
  await page.click('#captureScreen');
  if (picker) {
    await page.waitForSelector('#areaPicker.open');
    {
      if (pick === 'whole') await page.keyboard.press('Enter');
      else if (pick === 'cancel') await page.keyboard.press('Escape');
      else if (pick === 'wholeButton') await page.click('#areaWhole');
      else if (pick === 'cancelButton') await page.click('#areaCancel');
      else {
        const [a, b] = await page.evaluate(({ from, to }) => {
          const r = document.getElementById('areaCanvas').getBoundingClientRect();
          const c = document.getElementById('areaCanvas');
          const toScreen = ([x, y]) => [r.left + x * r.width / c.width, r.top + y * r.height / c.height];
          return [toScreen(from), toScreen(to)];
        }, pick);
        await page.mouse.move(a[0], a[1]);
        await page.mouse.down();
        await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 3 });
        await page.mouse.move(b[0], b[1], { steps: 3 });
        await page.mouse.up();
      }
    }
  }
  await page.waitForFunction(({ before, expectPicture }) =>
    window.__share.calls > 0 && !capturing
      && (!expectPicture || (img && img.complete && img.src !== before
                             && canvas.width === img.naturalWidth)),
    { before, expectPicture });
}

// What the picker showed while it was open, read after the fact.
async function pickerShown(page) {
  return page.evaluate(() => {
    const p = document.getElementById('areaPicker');
    const c = document.getElementById('areaCanvas').getBoundingClientRect();
    return { open: p.classList.contains('open'), canvas: [Math.round(c.width), Math.round(c.height)] };
  });
}

function shown(page, id) {
  return page.evaluate(id => {
    const b = document.getElementById(id).getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  }, id);
}

async function menuLabels(page) {
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.waitForTimeout(200);
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('#contextMenu button')]
      .map(b => b.textContent.trim()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  return labels;
}

(async () => {
  const r = {};
  const { browser, page, errors } = await open({ viewport: { width: 1200, height: 900 } });

  r.desktop = {
    button: await shown(page, 'captureScreen'),
    menu: (await menuLabels(page)).includes('Capture screen…'),
  };

  // A window or a tab: taken at once. The worked-on picture before it is
  // replaced by a clean document, as an opened or pasted one is.
  await seedPhoto(page, { width: 800, height: 500, colour: '#3d6b8f' });
  await page.evaluate(() => {
    shapes.push({ type: 'rect', x: 60, y: 60, w: 200, h: 120, rotation: 0, color: '#f00', size: 5, id: 1 });
    redraw();
  });
  await fakeShare(page, { surface: 'window', colour: '#2a8c4a' });
  await captureAndSettle(page);
  r.window = await captureState(page);

  // The whole screen: Etch is in front of it when the picker closes, so there
  // is a countdown to get it out of the way first.
  await fakeShare(page, { surface: 'monitor', width: 1280, height: 720, colour: '#a03c78' });
  await captureAndSettle(page);
  r.monitor = await captureState(page);

  // A rectangle: dragged round the square, which becomes the whole picture.
  // Dragged from bottom-right to top-left, because people do.
  const square = { x: 300, y: 120, w: 200, h: 150, colour: '#e0a020' };
  await fakeShare(page, { surface: 'window', width: 800, height: 450, colour: '#2a8c4a', square });
  await captureAndSettle(page, { pick: { from: [500, 270], to: [300, 120] } });
  r.area = await captureState(page);
  r.area.picker = await pickerShown(page);

  // The picker's buttons do what Enter and Escape do.
  await fakeShare(page, { surface: 'window', width: 400, height: 300, colour: '#2050c0' });
  await captureAndSettle(page, { pick: 'wholeButton' });
  r.wholeButton = await captureState(page);

  // A click without a drag is not a rectangle: the picker stays open.
  await fakeShare(page, { surface: 'window', width: 400, height: 300, colour: '#c02050' });
  const before = await page.evaluate(() => img.src);
  await page.click('#captureScreen');
  await page.waitForSelector('#areaPicker.open');
  {
    const r0 = await page.locator('#areaCanvas').boundingBox();
    await page.mouse.click(r0.x + r0.width / 2, r0.y + r0.height / 2);
  }
  r.click = { stillOpen: await page.evaluate(() =>
    document.getElementById('areaPicker').classList.contains('open') && capturing) };
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !capturing);
  r.click.after = await page.evaluate(b => ({ same: img.src === b,
    closed: !document.getElementById('areaPicker').classList.contains('open') }), before);

  // Escape in the area picker: the old picture stays, the share still ends.
  await fakeShare(page, { surface: 'window', width: 400, height: 300, colour: '#c02050' });
  await captureAndSettle(page, { pick: 'cancel', expectPicture: false });
  r.areaCancelled = await captureState(page);
  r.areaCancelled.sameImage = await page.evaluate(b => img.src === b, before);

  // Cancel in the browser's own picker: nothing changes, nothing is reported
  // as broken, and the area picker never appears.
  await fakeShare(page, { refuse: true });
  await captureAndSettle(page, { expectPicture: false, picker: false });
  r.cancelled = await captureState(page);
  r.cancelled.picker = await pickerShown(page);

  // A browser without the call has no button to offer.
  r.unsupported = await page.evaluate(() => {
    const keep = navigator.mediaDevices.getDisplayMedia;
    delete navigator.mediaDevices.getDisplayMedia;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true });
    updateCaptureAvailability();
    const b = document.getElementById('captureScreen').getBoundingClientRect();
    const hidden = b.width === 0;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: keep, configurable: true, writable: true });
    updateCaptureAvailability();
    return hidden;
  });
  r.errors = errors;
  await page.context().close();

  // A narrow desktop window takes the phone layout and its four-button pill.
  {
    const { page: p, context } = await open({ browser, viewport: { width: 520, height: 800 } });
    r.narrow = { button: await shown(p, 'captureScreen') };
    await context.close();
  }

  // A phone.
  {
    const { page: p, context } = await open({ browser, device: 'iPhone 13' });
    await seedPhoto(p, { width: 800, height: 500 });
    r.phone = {
      button: await shown(p, 'captureScreen'),
      offered: await p.evaluate(() => canCaptureScreen()),
    };
    await context.close();
  }

  finish(r, {
    'desktop.button': isTrue,
    'desktop.menu': isTrue,

    'window.calls': 1,
    'window.image': [640, 360],
    'window.pixel': [42, 140, 74],
    'window.shapes': 0,
    'window.undoSteps': 0,
    'window.shareEnded': isTrue,
    'window.waits': isEmpty,
    'window.askedWidthMax': atLeast(7680),
    'window.name': n => /^Screenshot \d{4}-\d\d-\d\d at \d\d\.\d\d\.\d\d\.png$/.test(n),

    'monitor.image': [1280, 720],
    'monitor.pixel': [160, 60, 120],
    'monitor.shareEnded': isTrue,
    'monitor.waits': [1000, 1000, 1000],

    // The square, and only the square, give or take the screen pixel a
    // mouse lands on when the frame is shown smaller than it is.
    'area.image.0': near(200, 4),
    'area.image.1': near(150, 4),
    'area.pixel': [224, 160, 32],
    'area.shapes': 0,
    'area.shareEnded': isTrue,
    'area.picker.open': isFalse,

    'wholeButton.image': [400, 300],
    'wholeButton.pixel': [32, 80, 192],

    'click.stillOpen': isTrue,
    'click.after.same': isTrue,
    'click.after.closed': isTrue,

    'areaCancelled.calls': 1,
    'areaCancelled.sameImage': isTrue,
    'areaCancelled.shareEnded': isTrue,
    'areaCancelled.toast': t => !/Could not/.test(t),

    'cancelled.calls': 1,
    'cancelled.image': [400, 300],
    'cancelled.pixel': [32, 80, 192],
    'cancelled.picker.open': isFalse,

    'unsupported': isTrue,
    'narrow.button': isFalse,
    'phone.button': isFalse,
    'phone.offered': isFalse,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
