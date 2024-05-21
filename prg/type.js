const { Type } = require('@sinclair/typebox');
const { Value } = require('@sinclair/typebox/value');

/**
 * @template {import('@sinclair/typebox/type').TSchema} S
 * @param {S} schema
 * @typedef {import('@sinclair/typebox').Static<S>} Static
 */

/**
 * Validates the given data and return **type-annotated** object.
 * Throws an error if there are any validation errors.
 * @template {import('@sinclair/typebox/type').TSchema} S
 * @param {S} schema
 * @return {Static<S>}
 */
function validate(schema, data) {
  if(schema.default != null) {
    data = Value.Default(schema, Value.Clone(data))
  }
  const errors = [...Value.Errors(schema, data)]
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2))
  return data
}

/**
 * nested objectの下にdefaultがある場合に、そのdefaultを上に伝播させる
 * @template {import('@sinclair/typebox/type').TSchema} S
 * @param {S} schema
 */
function propagateDefaultToParent(schema){
  if (schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      propagateDefaultToParent(prop)
      if ('default' in prop && !('default' in schema)) {
        schema.default = {}
      }
    }
  }
  return schema // inplaceに書き換えてるが、関数をwrapしやすいように
}

function toJSONSchema(schema){
  return JSON.stringify(Type.Strict(schema), null, 2)
}

///////////////////////////////////////////////////////////////////////////////

const PromptOption = propagateDefaultToParent(Type.Object({
  output: Type.Object({
    backup: Type.Boolean({default: false}),
    type: Type.Union([Type.Literal('normal'), Type.Literal('diff'), Type.Literal('append')], {default: 'diff'}),
    // append: Type.Boolean(),
  })
}))
/** @typedef {Static<PromptOption>} PromptOptionType */


module.exports = { Type, validate, PromptOption }

// console.log(toJSONSchema(PromptOption))
// console.log(validate(PromptOption, {}))
