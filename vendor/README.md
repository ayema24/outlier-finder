# vendor/

- `tesseract.min.js` is [tesseract.js](https://github.com/naptha/tesseract.js) **5.1.1**, unmodified, copied from the npm package (`dist/tesseract.min.js`). License: Apache-2.0 (`tesseract.js-LICENSE.md`).
- It is loaded from here (same origin) only when you use **Find channel**, so no third-party script ever runs on the page that holds your API key.
- At runtime it downloads its worker, WebAssembly core and English language data from jsDelivr / projectnaptha. Those run in a Web Worker, which cannot read `localStorage`.
- The bundle also contains `regenerator-runtime` (MIT, Copyright (c) 2014-present, Facebook, Inc.).
