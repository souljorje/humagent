# Third-party notices and extraction record

Humagent does not depend on the Lavish or Human Review packages. It selectively
adapts small MIT-licensed helpers and uses their behavior as design references.
The typed durable protocol, receipt store and isolated localhost proxy are new,
not a copied or upstream-compatible server.

## Lavish AXI

Source: https://github.com/kunchenguid/lavish-axi
Pinned revision: `69bf3090b24a04773ffd05d2e0b23d91ca41923b` (0.1.96).
Source file: `src/artifact-sdk.js`, blob `fe285b0503434be1f2dcd221e2f2830cb7a52dcd`.
Adapted destination: `web/vendor/targets.js`.

Retained/adapted: selector path construction, native/ARIA interactive-control
classification, rendered element context. Removed: layout diagnostics,
Mermaid/Excalidraw integration, attachments and donor UI. Humagent adds stable
`data-humagent-id` targets and keeps highlights outside application elements.
The browser-shell/SDK/wait/reply architecture and default-interaction separation
are design references, not copied server implementations.

MIT License

Copyright (c) 2026 Kun Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Human Review

Source: https://github.com/petergyang/human-review
Source revision: `dbcb7a69fa4739c4245ee178468f2bc2d6fb2991`.
Source file: `src/anchor-text.js`, blob `c264c21e4d4509916e2a7f333b5dbdefbb0d2b8f`.
Adapted destination: `web/vendor/anchors.js`.

Retained/adapted: quote/prefix/suffix context, occurrence scoring and whitespace
normalization with offset mapping. Changes: equally scored ambiguous matches
return null instead of selecting the first occurrence. Core tests cover the
adapted contract. Exact-edit versus comment semantics and source-preservation
rules are behavioral references; the global contenteditable editor is not copied.

MIT License

Copyright (c) 2026 Peter Yang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
