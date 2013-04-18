(function() {
  'use strict';

  var escope = typeof window !== 'undefined' ? window.escope : require('escope');
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

  function declareScopeVariables(scopes, node) {
    for (var i = 0; i < scopes.length; i++) {
      if (scopes[i].block === node) {
        var variables = scopes[i].variables;

        if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
          variables = variables.filter(function(variable) {
            return variable.name !== 'arguments' && node.params.every(function(param) {
              return param.name !== variable.name;
            });
          });
        }

        if (variables.length === 0) {
          return {
            type: 'EmptyStatement'
          };
        }

        return {
          type: 'VariableDeclaration',
          declarations: variables.map(function(variable) {
            return {
              type: 'VariableDeclarator',
              id: {
                type: 'Identifier',
                name: variable.name
              },
              init: null
            };
          }),
          kind: 'var'
        };
      }
    }
    assert(false);
  }

  function normalize(node) {
    var scopes = escope.analyze(node).scopes;
    return replaceWithParent(node, {
      leave: function(node) {
        // Hoist global variables
        if (node.type === 'Program') {
          return {
            type: 'Program',
            body: [declareScopeVariables(scopes, node)].concat(node.body)
          };
        }

        // Hoist local variables
        if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
          return {
            type: node.type,
            id: node.id,
            params: node.params,
            defaults: node.defaults,
            body: {
              type: 'BlockStatement',
              body: [declareScopeVariables(scopes, node)].concat(node.body.body)
            },
            rest: node.rest,
            generator: node.generator,
            expression: node.expression
          };
        }

        if (node.type === 'Property') {
          assert(node.key.type === 'Literal' || node.key.type === 'Identifier');
          return {
            type: 'Property',
            key: {
              type: 'Literal',
              value: node.key.type === 'Literal' ? node.key.value + '' : node.key.name
            },
            value: node.value,
            kind: node.kind
          };
        }

        if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
          return {
            type: 'MemberExpression',
            computed: true,
            object: node.object,
            property: {
              type: 'Literal',
              value: node.property.name
            }
          };
        }

        if (node.type === 'VariableDeclaration') {
          var expressions = node.declarations.filter(function(node) {
            return node.init !== null;
          }).map(function(node) {
            return {
              type: 'AssignmentExpression',
              operator: '=',
              left: node.id,
              right: node.init
            }
          });

          if (expressions.length === 0) {
            return {
              type: 'EmptyStatement'
            };
          }

          return {
            type: 'ExpressionStatement',
            expression: {
              type: 'SequenceExpression',
              expressions: expressions
            }
          };
        }

        if (node.type === 'ForStatement' && node.init !== null) {
          return {
            type: 'ForStatement',
            init:
              node.init.type === 'EmptyStatement' ? null :
              node.init.type === 'ExpressionStatement' ? node.init.expression :
              node.init,
            test: node.test,
            update: node.update,
            body: node.body
          };
        }
      }
    });
  }

  function denormalize(node) {
    return replaceWithParent(node, {
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

        if (node.type === 'Property') {
          var key = node.key;
          assert(key.type === 'Literal');
          if (isValidIdentifier.test(key.value)) {
            key = {
              type: 'Identifier',
              name: key.value
            };
          }
          return {
            type: 'Property',
            key: key,
            value: node.value,
            kind: node.kind
          };
        }

        if (node.type === 'MemberExpression' && node.computed && node.property.type === 'Literal' && isValidIdentifier.test(node.property.value)) {
          return {
            type: 'MemberExpression',
            computed: false,
            object: node.object,
            property: {
              type: 'Identifier',
              name: node.property.value
            }
          };
        }
      }
    });
  }

  function foldConstants(node) {
    return replaceWithParent(node, {
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

          if (node.object.type === 'Literal' && typeof node.object.value === 'string') {
            if (node.property.value === 'length') {
              return {
                type: 'Literal',
                value: node.object.value.length
              };
            }

            if (typeof node.property.value === 'number') {
              // Check for a match inside the string literal
              var index = node.property.value >>> 0;
              if (index === +node.property.value && index < node.object.value.length) {
                return {
                  type: 'Literal',
                  value: node.object.value[index]
                };
              }

              // Optimize to an empty string literal (may still be a numeric property on String.prototype)
              return {
                type: 'MemberExpression',
                computed: true,
                object: {
                  type: 'Literal',
                  value: ''
                },
                property: node.property
              }
            }
          }

          if (node.object.type === 'ArrayExpression') {
            if (node.property.value === 'length') {
              return {
                type: 'Literal',
                value: node.object.elements.length
              };
            }

            if (typeof node.property.value === 'number') {
              // Check for a match inside the array literal
              var index = node.property.value >>> 0;
              if (index === +node.property.value && index < node.object.elements.length) {
                return node.object.elements[index];
              }

              // Optimize to an empty array literal (may still be a numeric property on Array.prototype)
              return {
                type: 'MemberExpression',
                computed: true,
                object: {
                  type: 'ArrayExpression',
                  elements: []
                },
                property: node.property
              }
            }
          }
        }
      }
    });
  }

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

  function hoistUseStrict(nodes) {
    var useStrict = false;

    nodes = nodes.filter(function(node) {
      if (node.type === 'ExpressionStatement' && node.expression.type === 'Literal' && node.expression.value === 'use strict') {
        useStrict = true;
        return false;
      }
      return true;
    });

    if (useStrict) {
      return [{
        type: 'ExpressionStatement',
        expression: {
          type: 'Literal',
          value: 'use strict'
        }
      }].concat(nodes);
    }

    return nodes;
  }

  function removeDeadCode(node) {
    return replaceWithParent(node, {
      leave: function(node) {
        if (node.type === 'Program') {
          return {
            type: 'Program',
            body: hoistUseStrict(flattenNodeList(filterDeadCode(node.body)))
          };
        }

        if (node.type === 'BlockStatement') {
          var body = hoistUseStrict(flattenNodeList(filterDeadCode(node.body)));

          if (!parent || (parent.type !== 'FunctionExpression' && parent.type !== 'FunctionDeclaration')) {
            if (body.length === 0) {
              return {
                type: 'EmptyStatement'
              };
            }

            if (body.length === 1) {
              return body[0];
            }
          }

          return {
            type: 'BlockStatement',
            body: body
          };
        }

        if (node.type === 'ForStatement') {
          if (node.test !== null && node.test.type === 'Literal' && !node.test.value) {
            if (node.init === null) {
              return {
                type: 'EmptyStatement'
              };
            }

            if (node.init.type === 'VariableDeclaration') {
              return node.init;
            }

            return {
              type: 'ExpressionStatement',
              expression: node.init
            };
          }
        }

        if (node.type === 'WhileStatement') {
          if (node.test.type === 'Literal' && !node.test.value) {
            return {
              type: 'EmptyStatement'
            };
          }
        }

        if (node.type === 'WithStatement') {
          if (node.body.type === 'EmptyStatement') {
            return {
              type: 'ExpressionStatement',
              expression: node.object
            };
          }
        }

        if (node.type === 'IfStatement') {
          if (node.test.type === 'Literal') {
            return node.test.value ? node.consequent : node.alternate || {
              type: 'EmptyStatement'
            };
          }

          if (node.consequent.type === 'EmptyStatement' && (node.alternate === null || node.alternate.type === 'EmptyStatement')) {
            return {
              type: 'ExpressionStatement',
              expression: node.test
            };
          }

          if (node.alternate !== null && node.alternate.type === 'EmptyStatement') {
            return {
              type: 'IfStatement',
              test: node.test,
              consequent: node.consequent,
              alternate: null
            };
          }
        }
      }
    });
  }

  var parent = null;

  // Wrap the visitor in a visitor that ensures parent is set correctly
  function replaceWithParent(node, visitor) {
    var stack = [];
    return estraverse.replace(node, {
      enter: function(node) {
        if (visitor.enter) node = visitor.enter(node) || node;
        stack.push(parent);
        parent = node;
        return node;
      },
      leave: function(node) {
        parent = stack.pop();
        if (visitor.leave) node = visitor.leave(node) || node;
        return node;
      }
    });
  }

  function optimize(node) {
    node = normalize(node);
    node = foldConstants(node);
    node = removeDeadCode(node);
    node = denormalize(node);
    return node;
  }

  esoptimize.optimize = optimize;

}.call(this));
