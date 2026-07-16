import assert from 'node:assert/strict';
import test from 'node:test';
import { safeInlineTitleHtml } from '../src/lib/inline-title';

test('renders only bibliographic emphasis markup',()=>{
  assert.equal(safeInlineTitleHtml('Xenakis <i>ST/10</i> and <b>Stria</b>'),'Xenakis <em>ST/10</em> and <strong>Stria</strong>');
});

test('keeps arbitrary title HTML inert',()=>{
  assert.equal(safeInlineTitleHtml('<img src=x onerror=alert(1)> <script>x</script>'),'&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;x&lt;/script&gt;');
});
