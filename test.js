var assert = require('assert');
var esprima = require('esprima');
var escodegen = require('escodegen');
var esoptimize = require('./esoptimize');

function bodyOfFunction(f) {
  return f.toString().replace(/^[^\{]*\{((?:.|\n)*)\}[^\}]*$/, '$1');
}

function test(input, expected) {
  input = esprima.parse(bodyOfFunction(input));
  expected = esprima.parse(bodyOfFunction(expected));
  assert.strictEqual(
    escodegen.generate(esoptimize.optimize(input)),
    escodegen.generate(expected));
}

it('numeric constants', function() {
  test(function() {
    var a = 0 / 0 * 2;
    var b = 100 / 0;
    var c = 100 / 0 * -2;
    var d = -0;
  }, function() {
    var a = 0 / 0;
    var b = 1 / 0;
    var c = -1 / 0;
    var d = 0;
  });
});

it('unary operators', function() {
  test(function() {
    a(
      !1,
      ~1,
      +1,
      -1,
      void 1,
      typeof 1,
      delete b
    );
    b++;
    b--;
    ++b;
    --b;
  }, function() {
    a(
      false,
      -2,
      1,
      -1,
      void 0,
      'number',
      delete b
    );
    b++;
    b--;
    ++b;
    --b;
  });
});

it('binary operators', function() {
  test(function() {
    a(
      1 + 2,
      1 - 2,
      1 * 2,
      1 / 2,
      1 % 2,
      1 & 2,
      1 | 2,
      1 ^ 2,
      1 << 2,
      1 >> 2,
      1 >>> 2,
      1 < 2,
      1 > 2,
      1 <= 2,
      1 >= 2,
      1 == 2,
      1 != 2,
      1 === 2,
      1 !== 2,
      0 && 1,
      0 || 1,
      1 instanceof b,
      1 in b
    );
    b = 2;
    b += 2;
    b -= 2;
    b *= 2;
    b /= 2;
    b %= 2;
    b &= 2;
    b |= 2;
    b ^= 2;
    b <<= 2;
    b >>= 2;
    b >>>= 2;
  }, function() {
    a(
      3,
      -1,
      2,
      0.5,
      1,
      0,
      3,
      3,
      4,
      0,
      0,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      0,
      1,
      1 instanceof b,
      1 in b
    );
    b = 2;
    b += 2;
    b -= 2;
    b *= 2;
    b /= 2;
    b %= 2;
    b &= 2;
    b |= 2;
    b ^= 2;
    b <<= 2;
    b >>= 2;
    b >>>= 2;
  });
});

it('sequence folding', function() {
  test(function() {
    var a = (1, 2, 3);
    var b = (1, x(), 2, y(), 3);
    var c = (1, (x(), 2), 3);
  }, function() {
    var a = 3;
    var b = (x(), y(), 3);
    var c = (x(), 3);
  });
});

it('logical negation', function() {
  test(function() {
    a(!(b < c));
    a(!(b > c));
    a(!(b <= c));
    a(!(b >= c));
    a(!(b == c));
    a(!(b != c));
    a(!(b === c));
    a(!(b !== c));
    a(!(b && c));
    a(!(b || c));
    a(!(b < c && d || e > f));
    a(!(b < c || d && e > f));
  }, function() {
    a(b >= c);
    a(b <= c);
    a(b > c);
    a(b < c);
    a(b != c);
    a(b == c);
    a(b !== c);
    a(b === c);
    a(!b || !c);
    a(!b && !c);
    a((b >= c || !d) && e <= f);
    a(b >= c && (!d || e <= f));
  });
});

it('array folding', function() {
  test(function() {
    var a = [1, 2][0];
    var b = [1, c()][0];
    var c = [1, 2][-1];
    var d = [1, 2][0.5];
  }, function() {
    var a = 1;
    var b = [1, c()][0];
    var c = [][-1];
    var d = [][0.5];
  });
});

it('object literal folding', function() {
  test(function() {
    var a = { 'x': 0, 'y': 1 }['x'];
    var b = { 'x': 0, 'y': 1 }.x;
    var c = { 1: 2, 3: 4 }[1];
  }, function() {
    var a = 0;
    var b = 0;
    var c = 2;
  });
});

it('property normalization', function() {
  test(function() {
    a(b['c']);
    a(b['c d']);
    a({ 1: 2, 'b': 'c' });
  }, function() {
    a(b.c);
    a(b['c d']);
    a({ '1': 2, b: 'c' });
  });
});

it('side-effect-free code removal', function() {
  test(function() {
    1;
    x;
    x.y;
    (function() {});
    'use strict';
    'not use strict';
  }, function() {
    'use strict';
  });
});

it('block flattening', function() {
  test(function() {
    a();
    ;
    { ; b(); { c(); } d(), e(); }
    f();
  }, function() {
    a();
    b();
    c();
    d();
    e();
    f();
  });
});

it('ternary expression folding', function() {
  test(function() {
    a(true ? b() : c());
  }, function() {
    a(b());
  });
});

it('remove empty if body', function() {
  test(function() {
    if (a()) { 1; }
    if (b()) { 1; } else { 2; }
  }, function() {
    a();
    b();
  });
});
