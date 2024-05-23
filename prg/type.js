const { Type } = require('@sinclair/typebox');
const { Value } = require('@sinclair/typebox/value');
const { ValueErrorType } = require('@sinclair/typebox/errors');

/**
 * @typedef {import('@sinclair/typebox/type').TSchema} TSchema
 * @typedef {import('@sinclair/typebox/type').TProperties} TProperties
 */

/**
 * @template {TSchema} S
 * @typedef {import('@sinclair/typebox').Static<S>} Static
 */

/**
 * @template {TProperties} P
 * @param {P} schema
 */
function ExactObject(schema, option = {}) {
  return Type.Object(schema, {...option, additionalProperties: false})
}

/**
 * Validates the given data and return **type-annotated** object.
 * Throws an error if there are any validation errors.
 * @template {TSchema} S
 * @param {S} schema
 * @return {Static<S>}
 */
function parse(schema, data) {
  if (schema.defaultSchema != null) {
    data = Value.Default(schema.defaultSchema, Value.Clone(data)) // default埋め専用のスキーマを使う
  } else if (schema.default != null) {
    data = Value.Default(schema,               Value.Clone(data))
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
 * @template {TSchema} S
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

/**
 * JSON Schemaの形式で出力する
 */
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

// yaml schemaとしてはdefaultがあるものはoptionalで定義して書かなくても良いようにしておく (代わりに必ずdefaultを付ける)
const PromptInputArray = propagateDefaultToParent(
  Type.Array(
    Type.Union([
      // objectかstringのどちらか
      ExactObject({
        label:       Type.Optional(Type.String({default: ''})),
        description: Type.String(),
        output:      Type.Optional(ExactObject({
          backup:      Type.Optional(Type.Boolean({default: false})),
          type:        Type.Optional(Type.Union(OutputTypes, {default: 'diff'})),
        })),
      }),

      // リスト直下に文字列がある場合もOKとする (実装側でdescriptionに埋め直す)
      Type.String(),
    ])
  )
)
const PromptInput = PromptInputArray.items.anyOf[0]
/** @typedef {Static<typeof PromptInputArray>}                PromptInputArrayType */
/** @typedef {Static<typeof PromptInputArray.items.anyOf[0]>} PromptInputType */

// プログラム内では必ずValue.Defaultを通した後の状態で使うので、optionalを外した型も定義する
// 再帰的にRequiredを付ける実装はまだないので、今時点では2重管理する。optional型でValue.Defaultを通して、Required型でErrorチェックするので、型が合わない場合はエラーになる
// Partialの方はdeepPartialの試作があるらしい: https://github.com/sinclairzx81/typebox/blob/master/example/prototypes/partial-deep.ts
// ちなみにzodではdeepPartialがあるがdeepRequiredがまだないらしい → なくなるらしい…: https://github.com/colinhacks/zod/issues/2854
const PromptArray = (
  Type.Array(
    Type.Union([
      // objectかstringのどちらか
      ExactObject({
        label:       Type.String(),
        description: Type.String(),
        output:      ExactObject({
          backup:      Type.Boolean(),
          type:        Type.Union(OutputTypes),
        }),
      }),

      // リスト直下に文字列がある場合もOKとする (実装側でdescriptionに埋め直す)
      Type.String(),
    ])
  )
)
const Prompt = PromptArray.items.anyOf[0]
/** @typedef {Static<typeof PromptArray>}                PromptArrayType */
/** @typedef {Static<typeof PromptArray.items.anyOf[0]>} PromptType */

// Value.Default用のスキーマと関連付ける
PromptArray.defaultSchema = PromptInputArray
Prompt.defaultSchema = PromptInput

module.exports = {
  Type, parse, Prompt, PromptArray
}

///////////////////////////////////////////////////////////////////////////////

// console.log(toJSONSchema(PromptInputArray))

// console.log(parse(PromptArray, [
//   'pass', // ただの文字列はOK
//   {description: 'test'}, // default未設定のdescriptionされあれば後はdefaultが適用されてOK
// ]))
// console.log(parse(PromptArray, [
//   {}, // Prompt型でrequiredのdescriptionがないのでエラー (その際にPrompt型としてのエラーが表示される)
//   {description: 'test', output: {type: 'another'}}, // typeが候補にないのでエラー
//   {label: 4, description: 'test'}, // labelがstringでないのでエラー
// ]))
