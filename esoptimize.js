(function() {
  'use strict';

  var estraverse = typeof window !== 'undefined' ? window.estraverse : require('estraverse');
  var esoptimize = typeof window !== 'undefined' ? (window.esoptimize = {}) : exports;

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

  var oppositeOperator = {
    '&&': '||',
    '||': '&&',
    '<': '>=',
    '>': '<=',
    '<=': '>',
    '>=': '<',
    '==': '!=',
    '!=': '==',
    '!==': '===',
    '===': '!=='
  };

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
      if (node.type === 'Literal') {
        if (node.value === void 0) {
          return {
            type: 'UnaryExpression',
            operator: 'void',
            argument: {
              type: 'Literal',
              value: 0
            }
          };
        }

        if (typeof node.value === 'number') {
          if (isNaN(node.value)) {
            return {
              type: 'BinaryExpression',
              operator: '/',
              left: {
                type: 'Literal',
                value: 0
              },
              right: {
                type: 'Literal',
                value: 0
              }
            }
          }

          if (!isFinite(node.value)) {
            return {
              type: 'BinaryExpression',
              operator: '/',
              left: node.value < 0 ? {
                type: 'UnaryExpression',
                operator: '-',
                argument: {
                  type: 'Literal',
                  value: 1
                }
              } : {
                type: 'Literal',
                value: 1
              },
              right: {
                type: 'Literal',
                value: 0
              }
            }
          }

          if (node.value < 0) {
            return {
              type: 'UnaryExpression',
              operator: '-',
              argument: {
                type: 'Literal',
                value: -node.value
              }
            };
          }

          if (node.value === 0 && 1 / node.value < 0) {
            return {
              type: 'Literal',
              value: 0
            };
          }
        }
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
    enter: function(node) {
      if (node.type === 'UnaryExpression' && node.operator === '!') {
        if (node.argument.type === 'BinaryExpression' && node.argument.operator in oppositeOperator) {
          return {
            type: 'BinaryExpression',
            operator: oppositeOperator[node.argument.operator],
            left: node.argument.left,
            right: node.argument.right
          };
        }

        if (node.argument.type === 'LogicalExpression' && node.argument.operator in oppositeOperator) {
          return {
            type: 'LogicalExpression',
            operator: oppositeOperator[node.argument.operator],
            left: {
              type: 'UnaryExpression',
              operator: '!',
              argument: node.argument.left
            },
            right: {
              type: 'UnaryExpression',
              operator: '!',
              argument: node.argument.right
            }
          };
        }
      }
    },

    leave: function(node) {
      if (node.type === 'SequenceExpression') {
        var expressions = node.expressions;

        expressions = Array.prototype.concat.apply([], expressions.map(function(node) {
          return node.type === 'SequenceExpression' ? node.expressions : node;
        }));

        expressions = expressions.slice(0, -1).filter(hasSideEffects).concat(expressions.slice(-1));

        if (expressions.length > 1) {
          return {
            type: 'SequenceExpression',
            expressions: expressions
          };
        }

        return expressions[0];
      }

      if (node.type === 'UnaryExpression' && node.argument.type === 'Literal') {
        var operator = new Function('a', 'return ' + node.operator + ' a;');
        return {
          type: 'Literal',
          value: operator(node.argument.value)
        }
      }

      if ((node.type === 'BinaryExpression' || node.type === 'LogicalExpression') && node.left.type === 'Literal' && node.right.type === 'Literal') {
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

        if (node.object.type === 'ObjectExpression') {
          for (var i = 0; i < node.object.properties.length; i++) {
            var property = node.object.properties[i];
            assert(property.key.type === 'Literal' && typeof property.key.value === 'string');
            if (property.key.value === node.property.value + '') {
              return property.value;
            }
          }
        }

        if (node.object.type === 'ArrayExpression' && typeof node.property.value === 'number') {
          // Check for a match inside the array literal
          var index = node.property.value >>> 0;
          if (index === +node.property.value && index < node.object.elements.length) {
            return node.object.elements[index];
          }

          // Optimize to an empty array literal (may still be a numeric property on Array.prototype)
          return {
            type: 'MemberExpression',
            object: {
              type: 'ArrayExpression',
              elements: []
            },
            property: node.property,
            computed: true
          }
        }
      }
    }
  };

  function filterDeadCode(nodes) {
    return nodes.filter(function(node) {
      if (node.type === 'EmptyStatement') {
        return false;
      }

      // Users won't like it if we remove 'use strict' directives
      if (node.type === 'ExpressionStatement' && !hasSideEffects(node.expression) &&
          (node.expression.type !== 'Literal' || node.expression.value !== 'use strict')) {
        return false;
      }

      return true;
    });
  }

  function flattenNodeList(nodes) {
    return Array.prototype.concat.apply([], nodes.map(function(node) {
      if (node.type === 'BlockStatement') {
        return node.body;
      }

      if (node.type === 'ExpressionStatement' && node.expression.type === 'SequenceExpression') {
        return flattenNodeList(node.expression.expressions).map(function(node) {
          return {
            type: 'ExpressionStatement',
            expression: node
          }
        });
      }

      if (node.type === 'SequenceExpression') {
        return flattenNodeList(node.expressions);
      }

      return node;
    }));
  }

  var removeDeadCode = {
    leave: function(node) {
      if (node.type === 'Program') {
        return {
          type: 'Program',
          body: flattenNodeList(filterDeadCode(node.body))
        };
      }

      if (node.type === 'BlockStatement') {
        var body = flattenNodeList(filterDeadCode(node.body));

        if (body.length === 0) {
          return {
            type: 'EmptyStatement'
          };
        }

        return {
          type: 'BlockStatement',
          body: body
        };
      }

      if (node.type === 'IfStatement') {
        if (node.test.type === 'Literal') {
          return node.test.value ? node.consequent : node.alternate;
        }

        if (node.consequent.type === 'EmptyStatement' && (node.alternate === null || node.alternate.type === 'EmptyStatement')) {
          return {
            type: 'ExpressionStatement',
            expression: node.test
          };
        }

        if (node.alternate.type === 'EmptyStatement') {
          return {
            type: 'IfStatement',
            test: node.test,
            consequent: node.consequent,
            alternate: null
          };
        }
      }
    }
  };

  function optimize(node) {
    node = estraverse.replace(node, normalize);
    node = estraverse.replace(node, foldConstants);
    node = estraverse.replace(node, removeDeadCode);
    node = estraverse.replace(node, denormalize);
    return node;
  }

  esoptimize.optimize = optimize;

}.call(this));
