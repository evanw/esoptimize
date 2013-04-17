(function() {
  'use strict';

  var estraverse = this.estraverse || require('estraverse');
  var exports = this.exports || (this.esoptimize = {});

  var isValidIdentifier = new RegExp('^(?!(?:' + [
    'do',
    'if',
    'in',
    'for',
    'let',
    'new',
    'try',
    'var',
    'case',
    'else',
    'enum',
    'eval',
    'false',
    'null',
    'this',
    'true',
    'void',
    'with',
    'break',
    'catch',
    'class',
    'const',
    'super',
    'throw',
    'while',
    'yield',
    'delete',
    'export',
    'import',
    'public',
    'return',
    'static',
    'switch',
    'typeof',
    'default',
    'extends',
    'finally',
    'package',
    'private',
    'continue',
    'debugger',
    'function',
    'arguments',
    'interface',
    'protected',
    'implements',
    'instanceof'
  ].join('|') + ')$)[$A-Z_a-z][$A-Z_a-z0-9]*$');

  function assert(truth) {
    if (!truth) {
      throw new Error('assertion failed');
    }
  }

  function hasSideEffects(node) {
    if (node.type === 'Literal' || node.type === 'Identifier' || node.type === 'FunctionExpression') {
      return false;
    }

    if (node.type === 'MemberExpression') {
      return hasSideEffects(node.object) || hasSideEffects(node.property);
    }

    if (node.type === 'SequenceExpression') {
      return node.expressions.some(hasSideEffects);
    }

    if (node.type === 'ArrayExpression') {
      return node.elements.some(hasSideEffects);
    }

    if (node.type === 'ObjectExpression') {
      return node.properties.some(function(property) {
        return hasSideEffects(property.value);
      });
    }

    return true;
  }

  var normalize = {
    leave: function(node) {
      if (node.type === 'ObjectExpression') {
        return {
          type: 'ObjectExpression',
          properties: node.properties.map(function(property) {
            assert(property.key.type === 'Literal' || property.key.type === 'Identifier');
            return {
              key: {
                type: 'Literal',
                value: property.key.type === 'Literal' ? property.key.value + '' : property.key.name
              },
              value: property.value,
              kind: property.kind
            }
          })
        };
      }

      if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
        return {
          type: 'MemberExpression',
          object: node.object,
          property: {
            type: 'Literal',
            value: node.property.name
          },
          computed: true
        };
      }
    }
  };

  var denormalize = {
    leave: function(node) {
      if (node.type === 'Literal' && node.value === void 0) {
        return {
          type: 'UnaryExpression',
          operator: 'void',
          argument: {
            type: 'Literal',
            value: 0
          }
        };
      }

      if (node.type === 'ObjectExpression') {
        return {
          type: 'ObjectExpression',
          properties: node.properties.map(function(property) {
            var key = property.key;
            assert(key.type === 'Literal');
            if (isValidIdentifier.test(key.value)) {
              key = {
                type: 'Identifier',
                name: key.value
              };
            }
            return {
              key: key,
              value: property.value,
              kind: property.kind
            }
          })
        };
      }

      if (node.type === 'MemberExpression' && node.computed && node.property.type === 'Literal' && isValidIdentifier.test(node.property.value)) {
        return {
          type: 'MemberExpression',
          object: node.object,
          property: {
            type: 'Identifier',
            name: node.property.value
          }
        };
      }
    }
  };

  var foldConstants = {
    leave: function(node) {
      if (node.type === 'SequenceExpression' && !hasSideEffects(node)) {
        return node.expressions[node.expressions.length - 1];
      }

      if (node.type === 'BinaryExpression' && node.left.type === 'Literal' && node.right.type === 'Literal') {
        var operator = new Function('a', 'b', 'return a ' + node.operator + ' b;');
        return {
          type: 'Literal',
          value: operator(node.left.value, node.right.value)
        };
      }

      if (node.type === 'ConditionalExpression' && node.test.type === 'Literal') {
        return node.test.value ? node.consequent : node.alternate;
      }

      if (node.type === 'MemberExpression' && node.property.type === 'Literal' && !hasSideEffects(node.object)) {
        assert(node.computed);

        if (node.object.type === 'ObjectExpression' && typeof node.property.value === 'string') {
          for (var i = 0; i < node.object.properties.length; i++) {
            var property = node.object.properties[i];
            assert(property.key.type === 'Literal' && typeof property.key.value === 'string');

            if (property.key.value === node.property.value) {
              return property.value;
            }
          }

          return {
            type: 'Literal',
            value: void 0
          };
        }
      }
    }
  };

  var removeDeadCode = {
    leave: function(node) {
      // TODO:
      // - Remove EmptyStatement
      // - Remove ExpressionStatement with !hasSideEffects
    }
  };

  function optimize(node) {
    node = estraverse.replace(node, normalize);
    node = estraverse.replace(node, foldConstants);
    node = estraverse.replace(node, removeDeadCode);
    node = estraverse.replace(node, denormalize);
    return node;
  }

  exports.optimize = optimize;

}.call(this));
