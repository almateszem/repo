/** A szkenner kamerája nem maradhat bekapcsolva, ha a modált az engedélykérés
    közben zárják be (✕, Escape, kézi kód) — a start() eddig az await-ek után
    nem nézte, él-e még a szkennelés, és a rAF-ciklus is tovább pörgött. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
globalThis.window.isSecureContext = true;

/** Hamis stream: a track-ek leállítását számolja. */
const fakeStream = () => {
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
    getCapabilities: () => ({}),
  };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
};

/** A getUserMedia hívásai, egyenként kívülről feloldhatóan. */
const cameraRequests = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    vibrate() {},
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          cameraRequests.push(resolve);
        }),
    },
  },
});

// Natív dekóder: ha a kód „a kamera előtt van", mindig ugyanazt látja
let codeInView = true;
globalThis.window.BarcodeDetector = class {
  static async getSupportedFormats() {
    return ['ean_13'];
  }
  async detect() {
    return codeInView ? [{ rawValue: '5998200310010' }] : [];
  }
};

let frames = 0;
globalThis.requestAnimationFrame = (callback) => {
  frames += 1;
  return setTimeout(() => callback(performance.now() + frames * 1000), 0);
};

const { setupScanner } = await import('../../../../public/js/nutrition/scanner.js');
const scanner = setupScanner();

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const closeWithManualCode = (code) => {
  elementFor('#sc-manual-code').value = code;
  elementFor('[data-form="manual-barcode"]').dispatch('submit');
};
const errorText = () => elementFor('[data-sc-error]').textContent;

test('bezárás az engedélykérés közben: a később érkező stream leáll, nincs ciklus és hiba', async () => {
  cameraRequests.length = 0;
  frames = 0;
  const result = scanner.scan();
  closeWithManualCode('123');
  assert.equal(await result, '123');

  const late = fakeStream();
  cameraRequests[0](late); // most adja meg az engedélyt a felhasználó
  await settle();
  assert.equal(late.track.stopped, true, 'a kamera-LED nem marad égve');
  assert.equal(frames, 0, 'nem indul rAF ciklus');
  assert.equal(errorText(), '', 'nincs hiba-szöveg');
});

test('gyors újranyitás: a régi start nem ír az új munkamenetbe', async () => {
  cameraRequests.length = 0;
  codeInView = false; // az új munkamenet fut, de még nem lát kódot
  const first = scanner.scan();
  closeWithManualCode('1');
  await first;
  const second = scanner.scan(); // a régi start még a kamerára vár

  const fresh = fakeStream();
  cameraRequests[1](fresh);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const old = fakeStream();
  cameraRequests[0](old);
  await settle();

  assert.equal(old.track.stopped, true, 'a régi stream leáll');
  assert.equal(fresh.track.stopped, false, 'az új él');
  assert.equal(elementFor('[data-sc-video]').srcObject, fresh, 'a videó az újé');
  // az új munkamenet tickje fut, és két egyező leolvasás után lezár
  codeInView = true;
  assert.equal(await second, '5998200310010');
  assert.equal(fresh.track.stopped, true);
});

test('normál szkennelés változatlanul működik', async () => {
  cameraRequests.length = 0;
  const result = scanner.scan();
  const stream = fakeStream();
  cameraRequests[0](stream);
  assert.equal(await result, '5998200310010');
  assert.equal(stream.track.stopped, true, 'lezáráskor a kamera leáll');
  assert.equal(errorText(), '');
});
