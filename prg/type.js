const { Type } = require('@sinclair/typebox');
const { Value } = require('@sinclair/typebox/value');
const { ValueErrorType } = require('@sinclair/typebox/errors');

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
function parse(schema, data) {
  if(schema.default != null) {
    data = Value.Default(schema, Value.Clone(data))
  }

  function recursive(schema, data) {
    // Type.Unionはどの配下でもパースできなかった場合に 'expected union value' しか返してくれない
    // 候補型の1つ目 (anyOf[0]) がobjectの場合は、基本的にその型でパースされることを期待していると想定する
    // その場合にエラーメッセージが読みやすいように、anyOf[0]のスキーマに対して再帰的にErrorをチェックする
    return [...Value.Errors(schema, data)].flatMap(e => {
      if (e.type !== ValueErrorType.Union) return [e]
      const anyOf0 = e.schema.anyOf[0]
      if (anyOf0.type !== 'object') return [e]

      return recursive(anyOf0, e.value).map(ee => ({
        ...e,
        path: e.path + ee.path,
        message: ee.message,
      }))
    })
  }

  const errors = recursive(schema, data).map(({path, message}) => ({path, message}))
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2))

  return data
}

/**
 * nested objectの下にdefaultがある場合に、そのdefaultを上に伝播させる
 * @template {import('@sinclair/typebox/type').TSchema} S
 * @param {S} schema
 */
function propagateDefaultToParent(schema){
  if (schema.default != null) return schema

  if (schema.properties != null) { // object
    for (const [key, prop] of Object.entries(schema.properties)) {
      propagateDefaultToParent(prop)
      if ('default' in prop) {
        schema.default = {}
      }
    }
  } else if (schema.items != null) { // array
    propagateDefaultToParent(schema.items) // arrayの要素型という意味でitemsになっているが、schema.items自体は単数
    if ('default' in schema.items) {
      schema.default = []
    }
  } else if (schema.anyOf != null) { // union
    for (const type of schema.anyOf) {
      propagateDefaultToParent(type)
      // 最初にdefaultが付いているものがValue.Defaultで呼ばれるようなので、それに合わせる
      // 実際、1つ目にdefaultのないobject, 2つ目にdefaultのあるobjectを使った場合に、
      // どちらも{}を元にValue.Defaultできるが、2つ目のValue.Defaultが呼ばれていた
      if ('default' in type && schema.default == null) {
        schema.default = structuredClone(type.default)
      }
    }
  }

  return schema // inplaceに書き換えてるが、関数をwrapしやすいように
}

function toJSONSchema(schema){
  return JSON.stringify(Type.Strict(schema), null, 2)
}

///////////////////////////////////////////////////////////////////////////////

const OutputTypes = [
  Type.Literal('normal'),
  Type.Literal('diff'),
  Type.Literal('append'),
  Type.Literal('ask')
]

const Prompt = propagateDefaultToParent(Type.Object({
  label:       Type.Optional(Type.String({default: ''})),
  description: Type.String(),
  output:      Type.Optional(Type.Object({
    backup:      Type.Optional(Type.Boolean({default: false})),
    type:        Type.Optional(Type.Union(OutputTypes, {default: 'diff'})),
  })),
}))
/** @typedef {Static<Prompt>} PromptType */

const PromptYaml = propagateDefaultToParent(Type.Array(
  Type.Union([
    Prompt,
    Type.String(), // リスト直下に文字列がある場合もOKとする (実装側でdescriptionとして使う)
  ])
))
/** @typedef {Static<typeof PromptYaml>} PromptYamlType */

module.exports = { Type, parse, PromptYaml, Prompt }

///////////////////////////////////////////////////////////////////////////////

console.log(toJSONSchema(PromptYaml))

// console.log(parse(PromptYaml, [
//   'pass', // ただの文字列はOK
//   {description: 'test'}, // default未設定のdescriptionされあれば後はdefaultが適用されてOK
// ]))
// console.log(parse(PromptYaml, [
//   {}, // Prompt型でrequiredのdescriptionがないのでエラー (その際にPrompt型としてのエラーが表示される)
//   {description: 'test', output: {type: 'another'}}, // typeが候補にないのでエラー
//   {label: 4, description: 'test'}, // labelがstringでないのでエラー
// ]))
